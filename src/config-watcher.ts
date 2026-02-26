import chokidar, { FSWatcher } from 'chokidar';
import { info, error } from './logger.js';

export function watchConfig(
  configPath: string,
  onConfigChange: () => void
): FSWatcher {
  // usePolling — надёжнее в Docker-контейнерах
  // awaitWriteFinish — ждём завершения записи файла
  const watcher = chokidar.watch(configPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on('change', (changedPath: string) => {
    info(`[watch] Конфиг изменён: ${changedPath}`);
    setTimeout(() => {
      try {
        onConfigChange();
      } catch (err) {
        error(`[watch] Ошибка перезагрузки: ${(err as Error).message}`);
      }
    }, 500);
  });

  watcher.on('error', (err: unknown) => {
    error(`[watch] Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  });

  watcher.on('ready', () => {
    info(`[watch] Наблюдение за ${configPath} активно`);
  });

  return watcher;
}
