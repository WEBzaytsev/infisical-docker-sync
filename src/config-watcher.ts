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
    info(`config.yaml изменён (${changedPath}), перезагружаем`, { component: 'watch' });
    setTimeout(() => {
      try {
        onConfigChange();
      } catch (err) {
        error(`не удалось применить изменения config.yaml: ${(err as Error).message}`, { component: 'watch' });
      }
    }, 500);
  });

  watcher.on('error', (err: unknown) => {
    error(`ошибка наблюдения за config.yaml: ${err instanceof Error ? err.message : String(err)}`, { component: 'watch' });
  });

  watcher.on('ready', () => {
    info(`hot-reload config.yaml активен: ${configPath}`, { component: 'watch' });
  });

  return watcher;
}
