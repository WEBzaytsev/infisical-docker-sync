import { loadConfig } from './config-loader.js';
import { fetchEnv } from './infisical-client.js';
import { hasChanged, ensureEnvDir } from './env-watcher.js';
import { restartContainer } from './docker-manager.js';
import { watchConfig } from './config-watcher.js';
import { setLogLevel, info, debug, error, warn } from './logger.js';
import fs from 'fs/promises';
import path from 'path';

// Глобальная карта таймеров для каждого сервиса
const timers = new Map();

async function syncService(service, globalConfig) {
  try {
    const merged = {
      siteUrl: service.overrides?.siteUrl || globalConfig.siteUrl,
      clientId: service.overrides?.clientId || globalConfig.clientId,
      clientSecret: service.overrides?.clientSecret || globalConfig.clientSecret,
      environment: service.environment,
      projectId: service.projectId
    };

    info(`🔄 Синхронизация ${service.name}...`);
    const envVars = await fetchEnv(merged);
    
    if (Object.keys(envVars).length === 0) {
      warn(`Не удалось получить переменные окружения для ${service.name}`);
      return;
    }
    
    const envText = Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .sort() // Сортировка для стабильного порядка
      .join('\n');

    await ensureEnvDir(service.envPath);
    const changed = await hasChanged(service.envPath, envText);
    
    if (changed) {
      info(`📝 Обновление ${Object.keys(envVars).length} переменных для ${service.name}`);
      await fs.writeFile(service.envPath, envText);
      await restartContainer(service.container);
    } else {
      info(`✅ Переменные для ${service.name} не изменились (${Object.keys(envVars).length} переменных)`);
    }
  } catch (err) {
    error(`Ошибка синхронизации ${service.name}: ${err.message}`);
  }
}

function setupServiceSync(service, globalConfig) {
  // Остановим существующий таймер, если он был
  if (timers.has(service.name)) {
    clearInterval(timers.get(service.name));
  }
  
  // Определяем интервал для сервиса (приоритет у настройки сервиса)
  const intervalMs = (service.syncInterval || globalConfig.syncInterval || 60) * 1000;
  
  // Выводим информацию об интервале
  if (service.syncInterval) {
    info(`⏱️ Сервис ${service.name} использует собственный интервал: ${service.syncInterval} секунд`);
  }
  
  // Начальная синхронизация
  syncService(service, globalConfig);
  
  // Создаем таймер для периодической синхронизации
  const timer = setInterval(() => {
    info(`⏰ Периодическая синхронизация ${service.name} (интервал: ${intervalMs/1000}с)`);
    syncService(service, globalConfig);
  }, intervalMs);
  
  // Сохраняем таймер
  timers.set(service.name, timer);
}

// Путь к конфигурационному файлу
const configPath = process.env.CONFIG_PATH || path.resolve('./config.yaml');

async function reloadConfig() {
  try {
    info("🔄 Перезагрузка конфигурации...");
    
    // В ESM модулях нет доступа к require.cache, поэтому просто загружаем конфиг заново
    const config = await loadConfig(configPath);
    
    // Устанавливаем уровень логирования
    setLogLevel(config.logLevel);
    
    info(`📋 Загружена обновленная конфигурация: ${config.services.length} сервисов`);
    
    // Остановить все таймеры
    for (const [name, timer] of timers.entries()) {
      clearInterval(timer);
      debug(`⏹️ Остановлен таймер для ${name}`);
    }
    timers.clear();
    
    // Настроить новые таймеры для всех сервисов
    for (const service of config.services) {
      setupServiceSync(service, config);
    }
    
    info("✅ Конфигурация успешно перезагружена");
  } catch (err) {
    error("Ошибка при перезагрузке конфигурации:", err.message);
  }
}

async function main() {
  try {
    console.log("🚀 Запуск Infisical Docker Sync");
    
    // Загрузка первоначальной конфигурации
    const config = await loadConfig(configPath);
    
    // Устанавливаем уровень логирования
    setLogLevel(config.logLevel);
    
    info(`📋 Загружена конфигурация: ${config.services.length} сервисов`);
    info(`⏱️ Глобальный интервал синхронизации: ${config.syncInterval} секунд`);
    
    // Настройка наблюдения за файлом конфигурации
    watchConfig(configPath, reloadConfig);
    
    // Запуск синхронизации для всех сервисов
    for (const service of config.services) {
      setupServiceSync(service, config);
    }
    
  } catch (err) {
    error("Критическая ошибка:", err.message);
    process.exit(1);
  }
}

// Обработка сигналов завершения
process.on('SIGINT', () => {
  info("👋 Получен сигнал завершения, останавливаю таймеры...");
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  info("👋 Получен сигнал завершения, останавливаю таймеры...");
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  process.exit(0);
});

main(); 