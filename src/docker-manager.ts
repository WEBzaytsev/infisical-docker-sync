import { error, debug } from './logger.js';
import { EnvVars, RecreateRequest, RecreateResponse } from './types.js';

const PROXY_URL = process.env.PROXY_URL || 'http://recreate-proxy:8080';
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
const REQUEST_TIMEOUT_MS = 60_000;

export async function recreateContainer(
  containerName: string,
  envVars?: EnvVars,
  removedKeys: string[] = [],
): Promise<void> {
  const payload: RecreateRequest = {
    container: containerName,
    env: envVars,
    removed: removedKeys,
  };

  try {
    const res = await fetch(`${PROXY_URL}/recreate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proxy-token': PROXY_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const result = (await res.json().catch(() => ({}))) as RecreateResponse;

    if (!res.ok || !result.ok) {
      throw new Error(result.error ?? `proxy ответил ${res.status}`);
    }

    debug(`[docker] ${containerName}: пересоздание выполнено через proxy`);
  } catch (err) {
    error(`[docker] ${containerName}: ошибка пересоздания: ${(err as Error).message}`);
    throw err;
  }
}
