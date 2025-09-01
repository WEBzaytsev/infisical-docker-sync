import chokidar from 'chokidar';
import { info, error, debug } from './logger.js';

/**
 * Настраивает отслеживание изменений конфигурационного файла
 *
 * @param configPath - Путь к конфигурационному файлу
 * @param onConfigChange - Функция, которая будет вызвана при изменении конфигурации
 * @returns Объект для управления наблюдателем
 */
export function watchConfig(
  configPath: string,
  onConfigChange: () => void
): chokidar.FSWatcher {
  info(`Настройка наблюдения за файлом конфигурации: ${configPath}`);

  // Создаем наблюдателя, который будет отслеживать только указанный файл
  // usePolling: true для лучшей поддержки в Docker контейнерах
  // awaitWriteFinish: true чтобы избежать срабатывания на промежуточных изменениях
  const watcher = chokidar.watch(configPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000, // Проверять изменения каждую секунду
    awaitWriteFinish: {
      stabilityThreshold: 2000, // Ждать 2 секунды после последнего изменения
      pollInterval: 100, // Проверять каждые 100 мс, завершена ли запись
    },
  });

  // Обработка события изменения
  watcher.on('change', (changedPath: string) => {
    info(`[CONFIG] Конфигурационный файл изменен: ${changedPath}`);

    // Добавляем небольшую задержку перед перезагрузкой конфигурации,
    // чтобы убедиться, что файл полностью сохранен
    setTimeout(() => {
      try {
        onConfigChange();
      } catch (err) {
        error(
          `Ошибка при перезагрузке конфигурации: ${(err as Error).message}`
        );
      }
    }, 500);
  });

  // Обработка ошибок
  watcher.on('error', (err: Error) => {
    error(`Ошибка при наблюдении за файлом: ${err.message}`);
  });

  // Обработка события готовности (когда начато наблюдение)
  watcher.on('ready', () => {
    info('[OK] Наблюдение за конфигурационным файлом готово');
  });

  // Возвращаем наблюдателя, чтобы можно было закрыть его при необходимости
  return watcher;
}

/**
 * Останавливает отслеживание изменений конфигурационного файла
 *
 * @param watcher - Наблюдатель для закрытия
 */
export function stopWatchingConfig(watcher: chokidar.FSWatcher): void {
  if (watcher) {
    debug('[STOP] Остановка наблюдения за конфигурационным файлом');
    watcher
      .close()
      .then(() => {
        debug('[OK] Наблюдение за конфигурационным файлом остановлено');
      })
      .catch((err: Error) => {
        error(`Ошибка при остановке наблюдения: ${err.message}`);
      });
  }
}
