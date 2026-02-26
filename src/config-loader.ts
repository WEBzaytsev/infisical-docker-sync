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
  syncInterval: Joi.number().integer().min(10).default(60),
  logLevel: Joi.string()
    .valid(...Object.values(LOG_LEVELS))
    .default(LOG_LEVELS.INFO),
  services: Joi.array().items(
    Joi.object({
      container: Joi.string().required(),
      envFileName: Joi.string().required(),
      envDir: Joi.string().required(),
      projectId: Joi.string().required(),
      environment: Joi.string().required(),
      syncInterval: Joi.number().integer().min(10),
      overrides: Joi.object({
        siteUrl: Joi.string().uri(),
        clientId: Joi.string(),
        clientSecret: Joi.string(),
      }).optional(),
    })
  ),
});

export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);

    const raw = await fs.readFile(absolutePath, 'utf8');
    const parsed = YAML.parse(raw);

    // envFile -> envFileName: обратная совместимость
    if (parsed.services) {
      for (const service of parsed.services) {
        if (service.envFile && !service.envFileName) {
          service.envFileName = service.envFile;
          delete service.envFile;
        }
      }
    }

    const { error: validationError, value } = schema.validate(parsed);

    if (validationError) {
      throw new Error(`Валидация: ${validationError.message}`);
    }

    info(`[config] Загружено: ${value.services.length} сервисов из ${absolutePath}`);
    return value as Config;
  } catch (err) {
    error(`[config] Ошибка загрузки: ${(err as Error).message}`);
    throw err;
  }
}
