import { InfisicalSDK } from '@infisical/sdk';
import { error, debug } from './logger.js';
import { InfisicalCredentials, EnvVars, SecretResponse } from './types.js';

const sdkCache = new Map<string, InfisicalSDK>();
const authCache = new Map<string, Promise<unknown>>();

function getCacheKey(creds: { siteUrl: string; clientId: string; clientSecret: string }): string {
  return `${creds.siteUrl}|${creds.clientId}|${creds.clientSecret}`;
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
  await authCache.get(key)!;

  return sdk;
}

export async function fetchEnv({
  siteUrl,
  clientId,
  clientSecret,
  projectId,
  environment,
}: InfisicalCredentials): Promise<EnvVars> {
  try {
    const infisicalSdk = await getAuthenticatedSdk({ siteUrl, clientId, clientSecret });

    const response = (await infisicalSdk.secrets().listSecrets({
      environment,
      projectId,
      expandSecretReferences: true,
      viewSecretValue: true,
      secretPath: '/',
      recursive: true,
    })) as SecretResponse;

    // Подробная отладка структуры ответа
    debug(`Response type: ${typeof response}`);
    if (typeof response === 'object') {
      debug(`Response keys: ${Object.keys(response).join(', ')}`);
      if (response?.secrets?.length > 0) {
        debug(`Secret count: ${response.secrets.length}`);
      }
    }

    // Обработка ответа и преобразование в объект ключ-значение
    const output: EnvVars = {};

    if (Array.isArray(response?.secrets)) {
      response.secrets.forEach(secret => {
        if (secret?.secretKey && secret.secretValue !== undefined) {
          output[secret.secretKey] = secret.secretValue;
        }
      });
    }

    debug(`Final output keys: ${Object.keys(output).join(', ')}`);
    return output;
  } catch (err) {
    error(`Ошибка при получении секретов: ${(err as Error).message}`);
    throw err;
  }
}
