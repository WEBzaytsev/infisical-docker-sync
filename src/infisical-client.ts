import { InfisicalSDK } from '@infisical/sdk';
import { createHash } from 'crypto';
import { error, debug } from './logger.js';
import { InfisicalCredentials, EnvVars, SecretResponse } from './types.js';

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

export async function fetchEnv({
  siteUrl,
  clientId,
  clientSecret,
  projectId,
  environment,
  secretPath,
}: InfisicalCredentials): Promise<EnvVars> {
  try {
    const sdk = await getAuthenticatedSdk({ siteUrl, clientId, clientSecret });

    const response = (await sdk.secrets().listSecrets({
      environment,
      projectId,
      expandSecretReferences: true,
      viewSecretValue: true,
      secretPath,
      recursive: true,
    })) as SecretResponse;

    const output: EnvVars = {};

    if (Array.isArray(response?.secrets)) {
      for (const secret of response.secrets) {
        if (secret?.secretKey && secret.secretValue !== undefined) {
          output[secret.secretKey] = secret.secretValue;
        }
      }
    }

    debug(`получено ${Object.keys(output).length} секретов для ${environment}`, { component: 'infisical' });
    return output;
  } catch (err) {
    error(`не удалось получить секреты — проверьте siteUrl, credentials и доступ к проекту: ${(err as Error).message}`, { component: 'infisical' });
    throw err;
  }
}
