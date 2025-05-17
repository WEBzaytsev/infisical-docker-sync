import Joi from 'joi';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { LOG_LEVELS } from './logger.js';

const schema = Joi.object({
  siteUrl: Joi.string().uri().required(),
  clientId: Joi.string().required(),
  clientSecret: Joi.string().required(),
  syncInterval: Joi.number().integer().min(10).description('Интервал проверки обновлений в секундах').default(60),
  logLevel: Joi.string().valid(...Object.values(LOG_LEVELS)).description('Уровень логирования (debug, info, none)').default(LOG_LEVELS.INFO),
  defaultReloadPolicy: Joi.string().valid('restart', 'recreate').description('Политика перезагрузки по умолчанию').default('recreate'),
  services: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      container: Joi.string().required(),
      envFile: Joi.string().required().description('Имя файла .env (без пути)'),
      projectId: Joi.string().required(),
      environment: Joi.string().required(),
      syncInterval: Joi.number().integer().min(10).description('Переопределение интервала для конкретного сервиса'),
      reloadPolicy: Joi.string().valid('restart', 'recreate').description('Политика перезагрузки для сервиса'),
      overrides: Joi.object({
        siteUrl: Joi.string().uri(),
        clientId: Joi.string(),
        clientSecret: Joi.string()
      }).optional()
    })
  )
});

export async function loadConfig(configPath) {
  // Определяем путь к файлу конфигурации
  const filePath = configPath || process.env.CONFIG_PATH || './config.yaml';
  
  try {
    // Преобразуем относительный путь в абсолютный, если необходимо
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    console.log(`📂 Загрузка конфигурации из: ${absolutePath}`);
    
    const raw = await fs.readFile(absolutePath, 'utf8');
    const parsed = YAML.parse(raw);
    
    // Обратная совместимость: преобразуем envPath в envFile если нужно
    if (parsed.services) {
      for (const service of parsed.services) {
        if (service.envPath && !service.envFile) {
          // Извлекаем только имя файла из пути, если указан полный путь
          service.envFile = path.basename(service.envPath);
          delete service.envPath;
        }
      }
    }
    
    const { error, value } = schema.validate(parsed);
    
    if (error) {
      throw new Error(`Ошибка валидации конфигурации: ${error.message}`);
    }
    
    // Автоматически добавляем полный путь к env файлам
    for (const service of value.services) {
      // Используем новую структуру путей: /app/envs/НАЗВАНИЕ_сервиса/название_файла
      const serviceDir = path.join('/app/envs', service.name);
      service.envPath = path.join(serviceDir, service.envFile);
      console.log(`🔍 Файл .env для ${service.name}: ${service.envPath}`);
    }
    
    return value;
  } catch (error) {
    console.error(`❌ Ошибка загрузки конфига из ${filePath}: ${error.message}`);
    throw error;
  }
} 