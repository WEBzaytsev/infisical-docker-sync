import { InfisicalSDK } from '@infisical/sdk';
import { createHash } from 'crypto';
import { error, debug } from './logger.js';
import { InfisicalCredentials, EnvVars, SECRET_SCOPES, SecretRecord } from './types.js';

const sdkCache = new Map<string, InfisicalSDK>();
const authCache = new Map<string, Promise<unknown>>();

// L1: не храним clientSecret в ключе кэша — хешируем чтобы убрать
// plaintext-секрет из памяти Map (heap-dump защита)
function getCacheKey(creds: { siteUrl: string; clientId: string; clientSecret: string }): string {
  const hash = createHash('sha256')
    .update(`${creds.siteUrl}|${creds.clientId}|${creds.clientSecret}`)
    .digest('hex');
  return hash;
}

async function getAuthenticatedSdk(creds: {
  siteUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<InfisicalSDK> {
  const key = getCacheKey(creds);
  let sdk = sdkCache.get(key);

  if (!sdk) {
    sdk = new InfisicalSDK({ siteUrl: creds.siteUrl });
    sdkCache.set(key, sdk);
  }

  if (!authCache.has(key)) {
    const authPromise = sdk
      .auth()
      .universalAuth.login({ clientId: creds.clientId, clientSecret: creds.clientSecret })
      .catch(err => {
        authCache.delete(key);
        throw err;
      });
    authCache.set(key, authPromise);
  }
  await authCache.get(key);

  return sdk;
}

export class InfisicalSecretConflictError extends Error {
  readonly code = 'INFISICAL_SECRET_KEY_CONFLICT' as const;
  readonly secretKey: string;
  readonly secretPaths: string[];

  constructor(secretKey: string, secretPaths: string[]) {
    super(`ключ ${secretKey} найден в нескольких папках Infisical: ${secretPaths.join(', ')}`);
    this.name = 'InfisicalSecretConflictError';
    this.secretKey = secretKey;
    this.secretPaths = secretPaths;
  }
}

export class InfisicalResponseError extends Error {
  readonly code = 'INFISICAL_INVALID_RESPONSE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InfisicalResponseError';
  }
}

function isSecretRecord(value: unknown): value is SecretRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.secretKey === 'string' &&
    record.secretKey.length > 0 &&
    typeof record.secretValue === 'string' &&
    (record.secretPath === undefined || typeof record.secretPath === 'string');
}

function sourcePath(secret: SecretRecord, requestedPath: string): string {
  return secret.secretPath ?? requestedPath;
}

export function collectSecrets(response: unknown, requestedPath: string): EnvVars {
  if (typeof response !== 'object' || response === null || !('secrets' in response) || !Array.isArray(response.secrets)) {
    throw new InfisicalResponseError('Infisical вернул ответ без массива secrets');
  }

  const values = new Map<string, { value: string; secretPath: string }>();

  for (const secret of response.secrets) {
    if (!isSecretRecord(secret)) {
      throw new InfisicalResponseError('Infisical вернул секрет в неподдерживаемом формате');
    }

    const existing = values.get(secret.secretKey);
    if (existing) {
      throw new InfisicalSecretConflictError(secret.secretKey, [existing.secretPath, sourcePath(secret, requestedPath)]);
    }

    values.set(secret.secretKey, {
      value: secret.secretValue,
      secretPath: sourcePath(secret, requestedPath),
    });
  }

  return Object.fromEntries([...values].map(([key, entry]) => [key, entry.value]));
}

export async function fetchEnv({
  siteUrl,
  clientId,
  clientSecret,
  projectId,
  environment,
  secretPath,
  secretScope,
}: InfisicalCredentials): Promise<EnvVars> {
  try {
    const sdk = await getAuthenticatedSdk({ siteUrl, clientId, clientSecret });

    const response = (await sdk.secrets().listSecrets({
      environment,
      projectId,
      expandSecretReferences: true,
      viewSecretValue: true,
      secretPath,
      recursive: secretScope === SECRET_SCOPES.SUBTREE,
    }));

    const output = collectSecrets(response, secretPath);

    debug(`получено ${Object.keys(output).length} секретов: path=${secretPath}, scope=${secretScope}`, { component: 'infisical' });
    return output;
  } catch (err) {
    const target = `${environment}:${secretPath}`;
    if (err instanceof InfisicalSecretConflictError) {
      error(`${err.message}; синхронизация остановлена без изменения .env`, {
        component: 'infisical',
        target,
        details: { code: err.code, secretKey: err.secretKey, secretPaths: err.secretPaths },
      });
    } else if (err instanceof InfisicalResponseError) {
      error(`ответ Infisical не прошёл проверку: ${err.message}`, {
        component: 'infisical',
        target,
        details: { code: err.code },
      });
    } else {
      const message = err instanceof Error ? err.message : 'неизвестная ошибка';
      error(`не удалось получить секреты — проверьте siteUrl, credentials и доступ к проекту: ${message}`, { component: 'infisical', target });
    }
    throw err;
  }
}
