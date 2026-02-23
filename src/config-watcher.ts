import chokidar, { FSWatcher } from 'chokidar';
import { info, error } from './logger.js';

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
): FSWatcher {
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
  watcher.on('error', (err: unknown) => {
    error(`Ошибка при наблюдении за файлом: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Обработка события готовности (когда начато наблюдение)
  watcher.on('ready', () => {
    info('[OK] Наблюдение за конфигурационным файлом готово');
  });

  return watcher;
}
