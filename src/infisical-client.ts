import { InfisicalSDK } from '@infisical/sdk';
import { error, debug } from './logger.js';
import { InfisicalCredentials, EnvVars, SecretResponse } from './types.js';

export async function fetchEnv({
  siteUrl,
  clientId,
  clientSecret,
  projectId,
  environment,
}: InfisicalCredentials): Promise<EnvVars> {
  try {
    // Создаем экземпляр клиента Infisical
    const infisicalSdk = new InfisicalSDK({
      siteUrl, // Если не указано, по умолчанию https://app.infisical.com
    });

    // Аутентификация с помощью clientId и clientSecret
    await infisicalSdk.auth().universalAuth.login({
      clientId,
      clientSecret,
    });

    // Получение всех секретов для указанного проекта и окружения
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
