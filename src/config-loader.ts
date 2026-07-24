import Joi from 'joi';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { info, error } from './logger.js';
import { LOG_LEVELS, Config } from './types.js';

const schema = Joi.object({
  siteUrl: Joi.string().uri({ scheme: ['https', 'http'] }).required(),
  clientId: Joi.string().required(),
  clientSecret: Joi.string().required(),
  syncInterval: Joi.number().integer().min(10).default(60),
  logLevel: Joi.string()
    .valid(...Object.values(LOG_LEVELS))
    .default(LOG_LEVELS.INFO),
  services: Joi.array().items(
    Joi.object({
      container: Joi.string().required(),
      // M3: envFileName — только имя файла, без слешей и ..
      envFileName: Joi.string()
        .pattern(/^[^/\\]+$/, 'no path separators')
        .invalid('..', '.')
        .required(),
      envDir: Joi.string().required(),
      envFileOwner: Joi.string().pattern(/^\d+:\d+$/, 'uid:gid').optional(),
      pullImage: Joi.boolean().optional(),
      projectId: Joi.string().required(),
      environment: Joi.string().required(),
      syncInterval: Joi.number().integer().min(10),
      overrides: Joi.object({
        siteUrl: Joi.string().uri({ scheme: ['https', 'http'] }),
        clientId: Joi.string(),
        clientSecret: Joi.string(),
      }).optional(),
    })
  ).min(1).required(),
});

function isLocalHttpUrl(value: string): boolean {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  return url.protocol === 'http:' && (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  );
}

function assertSafeInfisicalUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol === 'https:' || isLocalHttpUrl(value)) return;

  throw new Error('http разрешён только для локального Infisical (localhost/127.0.0.1/::1); для остальных siteUrl используйте https');
}

function assertSafeInfisicalUrls(config: Config): void {
  assertSafeInfisicalUrl(config.siteUrl);
  for (const service of config.services) {
    if (service.overrides?.siteUrl) {
      assertSafeInfisicalUrl(service.overrides.siteUrl);
    }
  }
}

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
      throw new Error(`Ошибка конфигурации: ${validationError.message}`);
    }

    const config = value as Config;
    assertSafeInfisicalUrls(config);

    info(`config.yaml загружен: ${config.services.length} сервисов (${absolutePath})`, { component: 'config' });
    return config;
  } catch (err) {
    error(`не удалось прочитать config.yaml: ${(err as Error).message}`, { component: 'config' });
    throw err;
  }
}
