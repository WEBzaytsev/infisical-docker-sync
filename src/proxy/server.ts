import http from 'node:http';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import Joi from 'joi';
import { recreateContainer } from './docker-recreate.js';
import { info, error } from '../logger.js';
import { RecreateRequest } from '../types.js';

const PORT = Number(process.env.PROXY_PORT) || 8080;
const TOKEN = process.env.PROXY_TOKEN;
const MAX_BODY = 1024 * 1024; // 1 МБ — защита от unbounded body

if (!TOKEN) {
  error('[proxy] PROXY_TOKEN не задан — отказ запуска');
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

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

function tokenValid(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN as string);
  return a.length === b.length && timingSafeEqual(a, b);
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
  if (!tokenValid(headerToken(req.headers['x-proxy-token']))) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid json' });
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
      error(`[proxy] Необработанная ошибка: ${(err as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' });
    });
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  info(`[proxy] recreate-only proxy слушает :${PORT}`);
});
