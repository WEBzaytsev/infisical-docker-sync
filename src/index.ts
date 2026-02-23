import { loadConfig } from './config-loader.js';
import { fetchEnv } from './infisical-client.js';
import { envToDotenvFormat } from './env-format.js';
import { hasChanged, ensureEnvDir, updateServiceState } from './env-watcher.js';
import { recreateService } from './docker-manager.js';
import { watchConfig } from './config-watcher.js';
import { setLogLevel, info, debug, error, warn } from './logger.js';
import { stateManager } from './state-manager.js';

import fs from 'fs/promises';
import path from 'path';
import {
  Config,
  ServiceConfig,
  InfisicalCredentials,
  EnvVars,
} from './types.js';

// Глобальная карта таймеров для каждого сервиса
const timers = new Map<string, NodeJS.Timeout>();

async function syncService(
  service: ServiceConfig,
  globalConfig: Config
): Promise<void> {
  try {
    const merged: InfisicalCredentials = {
      siteUrl: service.overrides?.siteUrl || globalConfig.siteUrl,
      clientId: service.overrides?.clientId || globalConfig.clientId,
      clientSecret:
        service.overrides?.clientSecret || globalConfig.clientSecret,
      environment: service.environment,
      projectId: service.projectId,
    };

    info(`[SYNC] Синхронизация ${service.container}...`);
    const envVars: EnvVars = await fetchEnv(merged);

    if (Object.keys(envVars).length === 0) {
      warn(`Не удалось получить переменные окружения для ${service.container}`);
      return;
    }

    const variableCount = Object.keys(envVars).length;
    const envText = envToDotenvFormat(envVars);

    const envPath = path.join(service.envDir, service.envFileName);

    await ensureEnvDir(envPath);
    const changed = await hasChanged(service.container, envPath, envText, variableCount);

    if (changed) {
      info(
        `[UPDATE] Обновление ${variableCount} переменных для ${service.container}`
      );

      await fs.writeFile(envPath, envText);
      await updateServiceState(service.container, envPath, envText, variableCount);

      // Пересоздаём контейнер
      info('[RECREATE] Пересоздаём контейнер');
      await recreateService(service);
    } else {
      info(
        `[OK] Переменные для ${service.container} не изменились (${variableCount} переменных)`
      );
    }
  } catch (err) {
    error(
      `Ошибка синхронизации ${service.container}: ${(err as Error).message}`
    );
  }
}

function setupServiceSync(service: ServiceConfig, globalConfig: Config): void {
  // Остановим существующий таймер, если он был
  if (timers.has(service.container)) {
    clearInterval(timers.get(service.container));
  }

  // Определяем интервал для сервиса (приоритет у настройки сервиса)
  const intervalMs =
    (service.syncInterval || globalConfig.syncInterval || 60) * 1000;

  // Выводим информацию об интервале
  if (service.syncInterval) {
    info(
      `[TIMER] Сервис ${service.container} использует собственный интервал: ${service.syncInterval} секунд`
    );
  }

  // Начальная синхронизация
  void syncService(service, globalConfig);

  // Создаем таймер для периодической синхронизации
  const timer = setInterval(() => {
    info(
      `[TIMER] Периодическая синхронизация ${service.container} (интервал: ${intervalMs / 1000}с)`
    );
    void syncService(service, globalConfig);
  }, intervalMs);

  // Сохраняем таймер
  timers.set(service.container, timer);
}

// Путь к конфигурационному файлу
const configPath = process.env.CONFIG_PATH || '/app/data/config.yaml';

async function recreateConfig(): Promise<void> {
  try {
    info('[RELOAD] Перезагрузка конфигурации...');

    // В ESM модулях нет доступа к require.cache, поэтому просто загружаем конфиг заново
    const config = await loadConfig(configPath);

    // Устанавливаем уровень логирования
    setLogLevel(config.logLevel);

    info(
      `[CONFIG] Загружена обновленная конфигурация: ${config.services.length} сервисов`
    );

    // Остановить все таймеры
    for (const [containerName, timer] of timers.entries()) {
      clearInterval(timer);
      debug(`[STOP] Остановлен таймер для ${containerName}`);
    }
    timers.clear();

    // Настроить новые таймеры для всех сервисов
    for (const service of config.services) {
      setupServiceSync(service, config);
    }

    info('[RELOAD] Перезагрузка завершена, синхронизация запущена в фоне');
  } catch (err) {
    error(`Ошибка при перезагрузке конфигурации: ${(err as Error).message}`);
    error(
      'При ошибке перезагрузки синхронизация может быть прервана. Исправьте конфигурацию и сохраните файл снова.'
    );
  }
}

async function main(): Promise<void> {
  info('[START] Запуск Infisical Docker Sync');

  try {
    // Загружаем сохраненное состояние агента
    await stateManager.loadState();

    // Загрузка первоначальной конфигурации
    const config = await loadConfig(configPath);

    // Устанавливаем уровень логирования
    setLogLevel(config.logLevel);

    info(`[CONFIG] Загружена конфигурация: ${config.services.length} сервисов`);
    info(
      `[TIMER] Глобальный интервал синхронизации: ${config.syncInterval} секунд`
    );

    // Запуск синхронизации для всех сервисов
    for (const service of config.services) {
      setupServiceSync(service, config);
    }
  } catch (err) {
    error(`Ошибка загрузки конфигурации: ${(err as Error).message}`);
    error(
      'Приложение будет работать без синхронизации. Исправьте конфигурацию и перезапустите контейнер.'
    );
  }

  // Настройка наблюдения за файлом конфигурации (всегда, даже при ошибке)
  try {
    watchConfig(configPath, recreateConfig);
    info('[WATCHER] Наблюдение за конфигурацией активировано');
  } catch (err) {
    warn(
      `Не удалось настроить наблюдение за конфигурацией: ${(err as Error).message}`
    );
  }
}

function handleShutdown(): void {
  info('Получен сигнал завершения, останавливаю таймеры...');
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

void main();
