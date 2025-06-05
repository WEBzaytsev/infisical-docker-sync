import { InfisicalSDK } from '@infisical/sdk';
import { info, error, debug } from './logger.js';

export async function fetchEnv({ siteUrl, clientId, clientSecret, projectId, environment }) {
  try {
    // Создаем экземпляр клиента Infisical
    const infisicalSdk = new InfisicalSDK({
      siteUrl // Если не указано, по умолчанию https://app.infisical.com
    });

    // Аутентификация с помощью clientId и clientSecret
    await infisicalSdk.auth().universalAuth.login({
      clientId,
      clientSecret
    });

    // Получение всех секретов для указанного проекта и окружения
    const response = await infisicalSdk.secrets().listSecrets({
      environment, 
      projectId,
      expandSecretReferences: true,
      viewSecretValue: true,
      secretPath: '/',
      recursive: true
    });

    // Подробная отладка структуры ответа
    debug('Response type:', typeof response);
    if (typeof response === 'object') {
      debug('Response keys:', Object.keys(response));
      if (response.secrets && response.secrets.length > 0) {
        debug('Secret count:', response.secrets.length);
        // Полная структура первого секрета для анализа
        debug('Complete first secret:', JSON.stringify(response.secrets[0]));
      }
    }

    // Обработка ответа и преобразование в объект ключ-значение
    const output = {};
    
    if (response && Array.isArray(response.secrets)) {
      response.secrets.forEach(secret => {
        if (secret && secret.secretKey && secret.secretValue !== undefined) {
          output[secret.secretKey] = secret.secretValue;
        }
      });
    }

    debug('Final output keys:', Object.keys(output));
    return output;
  } catch (err) {
    error(`Ошибка при получении секретов: ${err.message}`);
    throw err;
  }
} 