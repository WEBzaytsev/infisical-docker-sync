import http from 'node:http';
import Joi from 'joi';
import { recreateContainer } from './docker-recreate.js';
import { tokenValid, validateProxyToken } from './security.js';
import { info, error } from '../logger.js';
import { RecreateRequest } from '../types.js';

const PORT = Number(process.env.PROXY_PORT) || 8080;
let TOKEN = '';
try {
  TOKEN = validateProxyToken(process.env.PROXY_TOKEN);
} catch (err) {
  error(`[proxy] ${(err as Error).message}`);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}
const MAX_BODY = 1024 * 1024; // 1 МБ — защита от unbounded body

const schema = Joi.object({
  container: Joi.string()
    .pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/, 'docker name')
    .max(255)
    .required(),
  env: Joi.object().pattern(Joi.string(), Joi.string().allow('')).optional(),
  removed: Joi.array().items(Joi.string()).optional(),
});

function headerToken(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? undefined : raw;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRecreate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!tokenValid(TOKEN, headerToken(req.headers['x-proxy-token']))) {
    sendJson(res, 401, { ok: false, error: 'неверный или отсутствующий x-proxy-token' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: 'тело запроса — невалидный JSON' });
    return;
  }

  const { error: vErr, value } = schema.validate(parsed);
  if (vErr) {
    sendJson(res, 400, { ok: false, error: vErr.message });
    return;
  }

  const { container, env, removed } = value as RecreateRequest;
  try {
    await recreateContainer(container, env, removed);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: (err as Error).message });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/recreate') {
    handleRecreate(req, res).catch((err: unknown) => {
      error(`[proxy] Внутренняя ошибка при пересоздании: ${(err as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'внутренняя ошибка proxy' });
    });
    return;
  }
  sendJson(res, 404, { ok: false, error: 'доступен только POST /recreate' });
});

server.listen(PORT, () => {
  info(`[proxy] proxy для пересоздания слушает порт ${PORT}`);
});
