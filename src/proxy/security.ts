import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const MIN_PROXY_TOKEN_LENGTH = 32;
const WEAK_PROXY_TOKENS = new Set([
  'changeme',
  'default',
  'password',
  'proxy-token',
  'secret',
  'test',
  'token',
]);

function isRepeatedSingleChar(value: string): boolean {
  return new Set(value).size === 1;
}

export function validateProxyToken(token: string | undefined): string {
  if (!token) {
    throw new Error('PROXY_TOKEN не задан — задайте переменную в .env и перезапустите recreate-proxy');
  }

  if (token.length < MIN_PROXY_TOKEN_LENGTH) {
    throw new Error(`PROXY_TOKEN слишком короткий — минимум ${MIN_PROXY_TOKEN_LENGTH} символа; используйте openssl rand -hex 32`);
  }

  const normalized = token.trim().toLowerCase();
  if (WEAK_PROXY_TOKENS.has(normalized) || isRepeatedSingleChar(normalized)) {
    throw new Error('PROXY_TOKEN выглядит как слабое значение — используйте случайную строку из openssl rand -hex 32');
  }

  return token;
}

export function tokenValid(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
