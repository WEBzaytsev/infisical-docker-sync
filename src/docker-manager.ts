import { error, debug } from './logger.js';
import { EnvVars, RecreateRequest, RecreateResponse } from './types.js';

const DEFAULT_PROXY_URL = 'http://recreate-proxy:8080';
const DEFAULT_ALLOWED_PROXY_HOSTS = ['recreate-proxy', 'localhost', '127.0.0.1', '::1'];

function allowedProxyHosts(): string[] {
  return (process.env.PROXY_ALLOWED_HOSTS || DEFAULT_ALLOWED_PROXY_HOSTS.join(','))
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.startsWith('127.');
}

export function validateProxyUrl(rawUrl: string, allowedHosts = allowedProxyHosts()): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PROXY_URL должен использовать http или https');
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = new Set(allowedHosts.map(host => host.toLowerCase()));
  if (!allowed.has(hostname) && !isLoopbackHostname(hostname)) {
    throw new Error(
      `PROXY_URL host ${hostname} не входит в список разрешённых внутренних hosts (${[...allowed].join(', ')})`
    );
  }

  return url.toString().replace(/\/$/, '');
}

const PROXY_URL = validateProxyUrl(process.env.PROXY_URL || DEFAULT_PROXY_URL);
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60_000;

function requestTimeoutMs(): number {
  const configured = process.env.PROXY_REQUEST_TIMEOUT_MS;
  if (configured === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;

  const timeout = Number(configured);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error('PROXY_REQUEST_TIMEOUT_MS должен быть положительным целым числом миллисекунд');
  }
  return timeout;
}

export async function recreateContainer(
  containerName: string,
  envVars?: EnvVars,
  removedKeys: string[] = [],
  pullImage?: boolean,
): Promise<void> {
  const payload: RecreateRequest = {
    container: containerName,
    env: envVars,
    removed: removedKeys,
    ...(pullImage === undefined ? {} : { pullImage }),
  };

  try {
    const res = await fetch(`${PROXY_URL}/recreate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proxy-token': PROXY_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });

    const result = (await res.json().catch(() => ({}))) as RecreateResponse;

    if (!res.ok || !result.ok) {
      throw new Error(result.error ?? `recreate-proxy ответил с кодом ${res.status}`);
    }

    debug(`[docker] ${containerName}: пересоздание выполнено через proxy`);
  } catch (err) {
    error(`[docker] ${containerName}: пересоздание через proxy не удалось: ${(err as Error).message}`);
    throw err;
  }
}
