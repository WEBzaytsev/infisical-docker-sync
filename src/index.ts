import { loadConfig } from './config-loader.js';
import { fetchEnv } from './infisical-client.js';
import { envToDotenvFormat } from './env-format.js';
import { hasChanged, ensureEnvDir, updateServiceState } from './env-watcher.js';
import { recreateContainer } from './docker-manager.js';
import { watchConfig } from './config-watcher.js';
import { setLogLevel, info, debug, error, warn } from './logger.js';
import { stateManager } from './state-manager.js';

import fs from 'fs/promises';
import path from 'path';
import { Config, ServiceConfig, InfisicalCredentials } from './types.js';

const timers = new Map<string, NodeJS.Timeout>();

async function syncService(service: ServiceConfig, globalConfig: Config): Promise<void> {
  try {
    const creds: InfisicalCredentials = {
      siteUrl: service.overrides?.siteUrl || globalConfig.siteUrl,
      clientId: service.overrides?.clientId || globalConfig.clientId,
      clientSecret: service.overrides?.clientSecret || globalConfig.clientSecret,
      environment: service.environment,
      projectId: service.projectId,
    };

    const envVars = await fetchEnv(creds);

    if (Object.keys(envVars).length === 0) {
      warn(`[sync] ${service.container}: пустой ответ`);
      return;
    }

    const variableCount = Object.keys(envVars).length;
    const envText = envToDotenvFormat(envVars);
    const envPath = path.join(service.envDir, service.envFileName);

    await ensureEnvDir(envPath);
    const changed = await hasChanged(service.container, envPath, envText, variableCount);

    if (changed) {
      await fs.writeFile(envPath, envText);
      await updateServiceState(service.container, envPath, envText, variableCount);
      info(`[sync] ${service.container}: записано ${variableCount} vars, пересоздание контейнера`);
      await recreateContainer(service.container, envVars);
    }
  } catch (err) {
    error(`[sync] ${service.container}: ${(err as Error).message}`);
  }
}

function setupServiceSync(service: ServiceConfig, globalConfig: Config): void {
  if (timers.has(service.container)) {
    clearInterval(timers.get(service.container));
  }

  const intervalMs = (service.syncInterval || globalConfig.syncInterval || 60) * 1000;

  if (service.syncInterval) {
    debug(`[sync] ${service.container}: интервал ${service.syncInterval}с`);
  }

  void syncService(service, globalConfig);

  const timer = setInterval(() => {
    debug(`[sync] ${service.container}: периодическая проверка`);
    void syncService(service, globalConfig);
  }, intervalMs);

  timers.set(service.container, timer);
}

const configPath = process.env.CONFIG_PATH || '/app/data/config.yaml';

async function recreateConfig(): Promise<void> {
  try {
    const config = await loadConfig(configPath);
    setLogLevel(config.logLevel);

    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    timers.clear();

    for (const service of config.services) {
      setupServiceSync(service, config);
    }

    info(`[config] Перезагружено: ${config.services.length} сервисов`);
  } catch (err) {
    error(`[config] Ошибка перезагрузки: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  info('[config] Запуск Infisical Docker Sync');

  try {
    await stateManager.loadState();
    const config = await loadConfig(configPath);
    setLogLevel(config.logLevel);

    info(`[config] ${config.services.length} сервисов, интервал ${config.syncInterval}с`);

    for (const service of config.services) {
      setupServiceSync(service, config);
    }
  } catch (err) {
    error(`[config] Ошибка загрузки: ${(err as Error).message}`);
  }

  try {
    watchConfig(configPath, recreateConfig);
  } catch (err) {
    warn(`[watch] Не удалось запустить: ${(err as Error).message}`);
  }
}

function handleShutdown(): void {
  info('[config] Завершение');
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

void main();
