import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { info, error } from './logger.js';
import { stateManager } from './state-manager.js';

/**
 * Хеширование строки данных для определения изменений
 */
function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Проверяет, изменилось ли содержимое файла по сравнению с новым контентом
 * Использует StateManager для персистентного хранения хешей
 *
 * @param serviceName - Имя сервиса для идентификации в состоянии
 * @param filePath - Путь к файлу .env
 * @param newContent - Новое содержимое файла
 * @returns True если файл изменился или не существует
 */
export async function hasChanged(
  serviceName: string,
  filePath: string,
  newContent: string
): Promise<boolean> {
  try {
    // Получаем хеш нового содержимого
    const newHash = hash(newContent);
    const variableCount = newContent.split('\n').filter(line => line.trim() && !line.startsWith('#')).length;

    // Проверяем через StateManager
    const changed = stateManager.hasServiceChanged(serviceName, newHash);
    
    info(`[CHECK] Проверка изменений для ${serviceName}:`);
    info(`  - Новый хеш: ${newHash.slice(0, 10)}...`);
    info(`  - Переменных: ${variableCount}`);
    info(`  - Изменился: ${changed ? 'ДА' : 'НЕТ'}`);

    if (changed) {
      info(`[CHANGE] Файл ${filePath} изменился:`);
      info(`  - Старый хеш: ${stateManager.getServiceState(serviceName)?.lastHash.slice(0, 10) || 'нет'}...`);
      info(`  - Новый хеш: ${newHash.slice(0, 10)}...`);

      // Сравниваем с файлом на диске для диагностики
      try {
        const existing = await fs.readFile(filePath, 'utf8');
        const existingLines = existing.split('\n').sort();
        const newLines = newContent.split('\n').sort();

        // Найдем добавленные строки
        const addedLines = newLines.filter(
          line => !existingLines.includes(line)
        );
        if (addedLines.length > 0) {
          info(`  - Добавлено строк: ${addedLines.length}`);
        }

        // Найдем удаленные строки
        const removedLines = existingLines.filter(
          line => !newLines.includes(line)
        );
        if (removedLines.length > 0) {
          info(`  - Удалено строк: ${removedLines.length}`);
        }
      } catch {
        info(`  - Файл ${filePath} не существует, будет создан`);
      }

    }

    return changed;
  } catch (err) {
    error(`Ошибка при проверке изменений: ${(err as Error).message}`);
    // В случае ошибки считаем, что файл изменился, чтобы обновить его
    return true;
  }
}

/**
 * Обновляет состояние сервиса после записи файла
 *
 * @param serviceName - Имя сервиса
 * @param filePath - Путь к файлу .env
 * @param content - Содержимое файла
 */
export async function updateServiceState(
  serviceName: string,
  filePath: string,
  content: string
): Promise<void> {
  try {
    const newHash = hash(content);
    const variableCount = content.split('\n').filter(line => line.trim() && !line.startsWith('#')).length;
    
    await stateManager.updateServiceState(serviceName, filePath, newHash, variableCount);
    info(`[STATE] Обновлено состояние сервиса ${serviceName}:`);
    info(`  - Хеш: ${newHash.slice(0, 10)}...`);
    info(`  - Переменных: ${variableCount}`);
    info(`  - Файл: ${filePath}`);
  } catch (err) {
    error(`Ошибка обновления состояния ${serviceName}: ${(err as Error).message}`);
  }
}

/**
 * Создает директорию для .env файла, если она не существует
 *
 * @param filePath - Путь к файлу .env
 */
export async function ensureEnvDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}
