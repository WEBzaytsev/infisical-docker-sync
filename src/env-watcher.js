import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { info, error, debug } from './logger.js';

/**
 * Хеширование строки данных для определения изменений
 */
function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Проверяет, изменилось ли содержимое файла по сравнению с новым контентом
 * 
 * @param {string} filePath - Путь к файлу .env
 * @param {string} newContent - Новое содержимое файла
 * @returns {Promise<boolean>} - True если файл изменился или не существует
 */
export async function hasChanged(filePath, newContent) {
  try {
    // Получаем хеш нового содержимого
    const newHash = hash(newContent);
    
    try {
      // Пытаемся прочитать существующий файл
      const existing = await fs.readFile(filePath, 'utf8');
      const existingHash = hash(existing);
      
      // Сравниваем хеши
      const changed = existingHash !== newHash;
      
      if (changed) {
        info(`📊 Файл ${filePath} изменился:`);
        info(`  - Старый хеш: ${existingHash.slice(0, 10)}...`);
        info(`  - Новый хеш: ${newHash.slice(0, 10)}...`);
        
        // Для дополнительной диагностики можно вывести отличающиеся строки
        const existingLines = existing.split('\n').sort();
        const newLines = newContent.split('\n').sort();
        
        // Найдем добавленные строки
        const addedLines = newLines.filter(line => !existingLines.includes(line));
        if (addedLines.length > 0) {
          info(`  - Добавлено строк: ${addedLines.length}`);
        }
        
        // Найдем удаленные строки
        const removedLines = existingLines.filter(line => !newLines.includes(line));
        if (removedLines.length > 0) {
          info(`  - Удалено строк: ${removedLines.length}`);
        }
      }
      
      return changed;
    } catch (err) {
      // Файл не существует, считаем это изменением
      info(`📁 Файл ${filePath} не существует, будет создан`);
      return true;
    }
  } catch (err) {
    error(`Ошибка при проверке изменений: ${err.message}`);
    // В случае ошибки считаем, что файл изменился, чтобы обновить его
    return true;
  }
}

/**
 * Создает директорию для .env файла, если она не существует
 * 
 * @param {string} filePath - Путь к файлу .env
 */
export async function ensureEnvDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Альтернативный подход - отслеживание изменений файла в реальном времени
 * Этот функционал можно добавить, если нужно мониторить изменения файлов извне
 * 
 * @param {string} filePath - Путь к файлу для отслеживания
 * @param {Function} callback - Функция обратного вызова при изменении
 */
/*
export function watchFile(filePath, callback) {
  try {
    // Используем fs.watch API для отслеживания изменений в файле
    const watcher = fs.watch(filePath, { encoding: 'utf8' }, 
      (eventType, filename) => {
        if (eventType === 'change') {
          console.log(`📝 Файл ${filename} был изменен извне`);
          callback(filename);
        }
      }
    );
    
    // Возвращаем watcher, чтобы его можно было остановить при необходимости
    return watcher;
  } catch (error) {
    console.error(`❌ Ошибка при установке наблюдения за файлом: ${error.message}`);
    return null;
  }
}
*/ 