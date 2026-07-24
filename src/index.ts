import { loadConfig } from './config-loader.js';
import { fetchEnv } from './infisical-client.js';
import { envToDotenvFormat } from './env-format.js';
import { hasChanged, ensureEnvDir, writeEnvFileSafely } from './env-watcher.js';
import { recreateContainer } from './docker-manager.js';
import { watchConfig } from './config-watcher.js';
import { setLogLevel, info, debug, error, warn } from './logger.js';
import { stateManager, StateManager } from './state-manager.js';

import fs from 'fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { Config, EnvVars, ServiceConfig, InfisicalCredentials } from './types.js';

const timers = new Map<string, NodeJS.Timeout>();
const syncInFlight = new Map<string, Promise<void>>();
const stateWritesInFlight = new Set<Promise<void>>();
let shuttingDown = false;

export interface SyncDependencies {
  fetchEnv: (credentials: InfisicalCredentials) => Promise<EnvVars>;
  recreateContainer: (
    containerName: string,
    envVars?: EnvVars,
    removedKeys?: string[],
    pullImage?: boolean,
  ) => Promise<void>;
  state: Pick<
    StateManager,
    'updateServiceState' | 'getPendingRecreate' | 'clearPendingRecreate'
  >;
}

const defaultSyncDependencies: SyncDependencies = {
  fetchEnv,
  recreateContainer,
  state: stateManager,
};

async function persistServiceState(
  state: SyncDependencies['state'],
  serviceName: string,
  envPath: string,
  envText: string,
  variableCount: number,
  removedKeys: string[],
): Promise<void> {
  const stateWrite = state.updateServiceState(serviceName, envPath, envText, variableCount, removedKeys);
  stateWritesInFlight.add(stateWrite);
  try {
    await stateWrite;
  } finally {
    stateWritesInFlight.delete(stateWrite);
  }
}

async function clearPendingRecreate(
  state: SyncDependencies['state'],
  serviceName: string,
): Promise<void> {
  const stateWrite = state.clearPendingRecreate(serviceName);
  stateWritesInFlight.add(stateWrite);
  try {
    await stateWrite;
  } finally {
    stateWritesInFlight.delete(stateWrite);
  }
}

async function syncServiceOnce(
  service: ServiceConfig,
  globalConfig: Config,
  dependencies: SyncDependencies = defaultSyncDependencies,
): Promise<void> {
  try {
    const creds: InfisicalCredentials = {
      siteUrl: service.overrides?.siteUrl || globalConfig.siteUrl,
      clientId: service.overrides?.clientId || globalConfig.clientId,
      clientSecret: service.overrides?.clientSecret || globalConfig.clientSecret,
      environment: service.environment,
      projectId: service.projectId,
    };

    const envVars = await dependencies.fetchEnv(creds);

    if (Object.keys(envVars).length === 0) {
      warn(`[sync] ${service.container}: Infisical вернул пустой список секретов — проверьте projectId и environment в config.yaml`);
      return;
    }

    const variableCount = Object.keys(envVars).length;
    const envPath = path.join(service.envDir, service.envFileName);
    const absPath = path.resolve(envPath);
    const absDir = path.resolve(service.envDir);

    if (!absPath.startsWith(absDir + path.sep) && absPath !== absDir) {
      throw new Error(`Небезопасный путь к .env: ${absPath} выходит за пределы envDir (${absDir}). Проверьте envFileName в config.yaml`);
    }

    await ensureEnvDir(envPath);
    const diff = await hasChanged(service.container, envPath, envVars);
    const pending = dependencies.state.getPendingRecreate(service.container);

    const removedKeys = [...new Set([
      ...(pending?.removedKeys || []),
      ...diff.removed,
    ])].filter(key => !(key in envVars));

    if (diff.hasDiff) {
      const envText = envToDotenvFormat(envVars);
      await persistServiceState(
        dependencies.state,
        service.container,
        envPath,
        envText,
        variableCount,
        removedKeys,
      );
      await writeEnvFileSafely(service.container, envPath, envText, service.envFileOwner);
      const written = await fs.stat(envPath);
      debug(`[sync] ${service.container}: env записан → ${absPath} (${written.size}б)`);
    }

    if (!diff.hasDiff && !pending) {
      debug(`[sync] ${service.container}: нет изменений, файл не записан: ${absPath}`);
      return;
    }

    info(`[sync] ${service.container}: ${diff.hasDiff ? `записано ${variableCount} переменных` : 'повторяем неудавшееся пересоздание'}, запрос пересоздания контейнера`);
    await dependencies.recreateContainer(service.container, envVars, removedKeys, service.pullImage);
    await clearPendingRecreate(dependencies.state, service.container);

    const changedKeys = [...diff.added, ...diff.changed, ...diff.removed];
    if (changedKeys.length > 0) {
      debug(`[sync] ${service.container}: применены ключи: ${changedKeys.slice(0, 5).join(', ')}${changedKeys.length > 5 ? ` (+${changedKeys.length - 5})` : ''}`);
    }
  } catch (err) {
    error(`[sync] ${service.container}: ${(err as Error).message}`);
  }
}

export function syncService(
  service: ServiceConfig,
  globalConfig: Config,
  dependencies: SyncDependencies = defaultSyncDependencies,
): Promise<void> {
  const existing = syncInFlight.get(service.container);
  if (existing) {
    debug(`[sync] ${service.container}: предыдущая синхронизация ещё выполняется, объединяем цикл`);
    return existing;
  }

  const sync = syncServiceOnce(service, globalConfig, dependencies).finally(() => {
    if (syncInFlight.get(service.container) === sync) {
      syncInFlight.delete(service.container);
    }
  });
  syncInFlight.set(service.container, sync);
  return sync;
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

    info(`[config] config.yaml перезагружен: ${config.services.length} сервисов`);
  } catch (err) {
    error(`[config] Не удалось перезагрузить config.yaml: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  info('[config] Запуск Infisical Docker Sync — загрузка config.yaml');

  const examplePath = '/app/config.example.yaml';
  if (!existsSync(configPath) && existsSync(examplePath)) {
    await fs.copyFile(examplePath, configPath);
    await fs.chmod(configPath, 0o600);
    info('[config] Создан config.yaml из примера — заполните credentials и services, затем перезапустите или сохраните файл');
  }

  try {
    await stateManager.loadState();
    const config = await loadConfig(configPath);
    setLogLevel(config.logLevel);

    info(`[config] Синхронизация: ${config.services.length} сервисов, интервал ${config.syncInterval} с`);

    for (const service of config.services) {
      setupServiceSync(service, config);
    }
  } catch (err) {
    error(`[config] Не удалось загрузить config.yaml: ${(err as Error).message}`);
  }

  try {
    watchConfig(configPath, recreateConfig);
  } catch (err) {
    warn(`[watch] Не удалось включить hot-reload config.yaml: ${(err as Error).message}`);
  }
}

async function handleShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  info('[config] Остановка агента');
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  await Promise.allSettled([...stateWritesInFlight]);
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  process.on('SIGINT', () => { void handleShutdown(); });
  process.on('SIGTERM', () => { void handleShutdown(); });
  void main();
}
