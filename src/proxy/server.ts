import http from 'node:http';
import { pathToFileURL } from 'node:url';
import Joi from 'joi';
import { recreateContainer } from './docker-recreate.js';
import { tokenValid, validateProxyToken } from './security.js';
import { info, error } from '../logger.js';
import { RecreateRequest } from '../types.js';

const DEFAULT_PORT = 8080;
const MAX_BODY = 1024 * 1024; // 1 МБ — защита от unbounded body

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const RESPONSE_CODES = {
  OK: 'ok',
  UNAUTHORIZED: 'unauthorized',
  ROUTE_NOT_FOUND: 'route_not_found',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  INVALID_JSON: 'invalid_json',
  REQUEST_BODY_READ_FAILED: 'request_body_read_failed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  VALIDATION_FAILED: 'validation_failed',
  RECREATE_FAILED: 'recreate_failed',
  INTERNAL_ERROR: 'internal_error',
} as const;

type ResponseCode = typeof RESPONSE_CODES[keyof typeof RESPONSE_CODES];
type RecreateHandler = (
  container: string,
  env?: RecreateRequest['env'],
  removed?: string[],
  pullImage?: boolean,
  signal?: AbortSignal,
) => Promise<void>;

interface JsonResponse {
  ok: boolean;
  code: ResponseCode;
  error?: string;
}

interface ProxyServerOptions {
  token?: string;
  recreate?: RecreateHandler;
}

const schema = Joi.object({
  container: Joi.string()
    .pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/, 'docker name')
    .max(255)
    .required(),
  env: Joi.object().pattern(Joi.string(), Joi.string().allow('')).optional(),
  removed: Joi.array().items(Joi.string()).optional(),
  pullImage: Joi.boolean().optional(),
});

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('payload too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

function headerToken(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? undefined : raw;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: JsonResponse,
  headers: http.OutgoingHttpHeaders = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(err);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

function requestPath(req: http.IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://proxy.local').pathname;
  } catch {
    return '/';
  }
}

async function handleRecreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  recreate: RecreateHandler,
): Promise<void> {
  if (!tokenValid(token, headerToken(req.headers['x-proxy-token']))) {
    sendJson(res, HTTP_STATUS.UNAUTHORIZED, {
      ok: false,
      code: RESPONSE_CODES.UNAUTHORIZED,
      error: 'неверный или отсутствующий x-proxy-token',
    });
    return;
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      sendJson(res, HTTP_STATUS.PAYLOAD_TOO_LARGE, {
        ok: false,
        code: RESPONSE_CODES.PAYLOAD_TOO_LARGE,
        error: `тело запроса больше ${MAX_BODY} байт`,
      });
      return;
    }
    sendJson(res, HTTP_STATUS.BAD_REQUEST, {
      ok: false,
      code: RESPONSE_CODES.REQUEST_BODY_READ_FAILED,
      error: 'не удалось прочитать тело запроса',
    });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, {
      ok: false,
      code: RESPONSE_CODES.INVALID_JSON,
      error: 'тело запроса — невалидный JSON',
    });
    return;
  }

  const { error: vErr, value } = schema.validate(parsed);
  if (vErr) {
    sendJson(res, HTTP_STATUS.UNPROCESSABLE_ENTITY, {
      ok: false,
      code: RESPONSE_CODES.VALIDATION_FAILED,
      error: vErr.message,
    });
    return;
  }

  const { container, env, removed, pullImage } = value as RecreateRequest;
  const abortController = new AbortController();
  const abortRecreate = (): void => abortController.abort();
  req.once('aborted', abortRecreate);
  res.once('close', abortRecreate);

  try {
    await recreate(container, env, removed, pullImage, abortController.signal);
    if (!abortController.signal.aborted) {
      sendJson(res, HTTP_STATUS.OK, { ok: true, code: RESPONSE_CODES.OK });
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      sendJson(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
        ok: false,
        code: RESPONSE_CODES.RECREATE_FAILED,
        error: (err as Error).message,
      });
    }
  } finally {
    req.removeListener('aborted', abortRecreate);
    res.removeListener('close', abortRecreate);
  }
}

export function createProxyServer(options: ProxyServerOptions = {}): http.Server {
  const token = options.token ?? validateProxyToken(process.env.PROXY_TOKEN);
  const recreate = options.recreate ?? recreateContainer;

  return http.createServer((req, res) => {
    if (requestPath(req) !== '/recreate') {
      sendJson(res, HTTP_STATUS.NOT_FOUND, {
        ok: false,
        code: RESPONSE_CODES.ROUTE_NOT_FOUND,
        error: 'доступен только POST /recreate',
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(
        res,
        HTTP_STATUS.METHOD_NOT_ALLOWED,
        {
          ok: false,
          code: RESPONSE_CODES.METHOD_NOT_ALLOWED,
          error: 'для /recreate доступен только метод POST',
        },
        { allow: 'POST' },
      );
      return;
    }

    handleRecreate(req, res, token, recreate).catch((err: unknown) => {
      error(`[proxy] Внутренняя ошибка при пересоздании: ${(err as Error).message}`);
      if (!res.headersSent) {
        sendJson(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
          ok: false,
          code: RESPONSE_CODES.INTERNAL_ERROR,
          error: 'внутренняя ошибка proxy',
        });
      }
    });
  });
}

export function startProxyServer(port = Number(process.env.PROXY_PORT) || DEFAULT_PORT): http.Server {
  const server = createProxyServer();
  server.listen(port, () => {
    info(`[proxy] proxy для пересоздания слушает порт ${port}`);
  });
  return server;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  try {
    startProxyServer();
  } catch (err) {
    error(`[proxy] ${(err as Error).message}`);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}
