import chokidar from 'chokidar';
import path from 'path';
import { info, error, debug } from './logger.js';

/**
 * Настраивает отслеживание изменений конфигурационного файла
 * 
 * @param {string} configPath - Путь к конфигурационному файлу
 * @param {Function} onConfigChange - Функция, которая будет вызвана при изменении конфигурации
 * @returns {chokidar.FSWatcher} - Объект для управления наблюдателем
 */
export function watchConfig(configPath, onConfigChange) {
  info(`👀 Настройка наблюдения за файлом конфигурации: ${configPath}`);
  
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
      pollInterval: 100 // Проверять каждые 100 мс, завершена ли запись
    }
  });

  // Обработка события изменения
  watcher.on('change', (changedPath) => {
    info(`📝 Конфигурационный файл изменен: ${changedPath}`);
    
    // Добавляем небольшую задержку перед перезагрузкой конфигурации,
    // чтобы убедиться, что файл полностью сохранен
    setTimeout(() => {
      try {
        onConfigChange();
      } catch (err) {
        error(`Ошибка при перезагрузке конфигурации: ${err.message}`);
      }
    }, 500);
  });

  // Обработка ошибок
  watcher.on('error', (err) => {
    error(`Ошибка при наблюдении за файлом: ${err.message}`);
  });

  // Обработка события готовности (когда начато наблюдение)
  watcher.on('ready', () => {
    info('✅ Наблюдение за конфигурационным файлом готово');
  });

  // Возвращаем наблюдателя, чтобы можно было закрыть его при необходимости
  return watcher;
}

/**
 * Останавливает отслеживание изменений конфигурационного файла
 * 
 * @param {chokidar.FSWatcher} watcher - Наблюдатель для закрытия
 */
export function stopWatchingConfig(watcher) {
  if (watcher) {
    debug('⏹️ Остановка наблюдения за конфигурационным файлом');
    watcher.close().then(() => {
      debug('✅ Наблюдение за конфигурационным файлом остановлено');
    }).catch((err) => {
      error(`Ошибка при остановке наблюдения: ${err.message}`);
    });
  }
} 