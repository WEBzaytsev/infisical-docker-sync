import Joi from 'joi';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { info, error } from './logger.js';
import { LOG_LEVELS, Config } from './types.js';

const schema = Joi.object({
  siteUrl: Joi.string().uri().required(),
  clientId: Joi.string().required(),
  clientSecret: Joi.string().required(),
  syncInterval: Joi.number()
    .integer()
    .min(10)
    .description('Интервал проверки обновлений в секундах')
    .default(60),
  logLevel: Joi.string()
    .valid(...Object.values(LOG_LEVELS))
    .description('Уровень логирования (debug, info, none)')
    .default(LOG_LEVELS.INFO),
  services: Joi.array().items(
    Joi.object({
      container: Joi.string().required(),
      envFileName: Joi.string().required().description('Имя файла .env'),
      envDir: Joi.string()
        .required()
        .description('Директория для env файла (монтированная в хост)'),
      projectId: Joi.string().required(),
      environment: Joi.string().required(),
      syncInterval: Joi.number()
        .integer()
        .min(10)
        .description('Переопределение интервала для конкретного сервиса'),
      overrides: Joi.object({
        siteUrl: Joi.string().uri(),
        clientId: Joi.string(),
        clientSecret: Joi.string(),
      }).optional(),
    })
  ),
});

export async function loadConfig(configPath?: string): Promise<Config> {
  // Определяем путь к файлу конфигурации
  const filePath = configPath || process.env.CONFIG_PATH || './config.yaml';

  try {
    // Преобразуем относительный путь в абсолютный, если необходимо
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    info(`Загрузка конфигурации из: ${absolutePath}`);

    const raw = await fs.readFile(absolutePath, 'utf8');
    const parsed = YAML.parse(raw);

    // Обратная совместимость: envFile -> envFileName
    if (parsed.services) {
      for (const service of parsed.services) {
        if (service.envFile && !service.envFileName) {
          service.envFileName = service.envFile;
          delete service.envFile;
        }
        // envDir теперь обязательный - старый fallback удален
      }
    }

    const { error, value } = schema.validate(parsed);

    if (error) {
      throw new Error(`Ошибка валидации конфигурации: ${error.message}`);
    }

    for (const service of value.services) {
      const envPath = path.join(service.envDir, service.envFileName);
      info(`[ENV] Env файл для ${service.container}: ${envPath}`);
    }

    return value as Config;
  } catch (err) {
    error(`Ошибка загрузки конфига из ${filePath}: ${(err as Error).message}`);
    throw err;
  }
}
