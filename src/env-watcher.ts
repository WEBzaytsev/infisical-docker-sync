import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { info, error, debug } from './logger.js';
import { stateManager } from './state-manager.js';

/**
 * Хеширование строки данных для определения изменений
 */
function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Проверяет, изменилось ли содержимое файла по сравнению с новым контентом
 * Сравнивает и с StateManager, и с реальным файлом на диске
 *
 * @param serviceName - Имя сервиса для идентификации в состоянии
 * @param filePath - Путь к файлу .env
 * @param newContent - Новое содержимое файла
 * @param variableCount - Количество переменных (если не передано — вычисляется из content)
 */
export async function hasChanged(
  serviceName: string,
  filePath: string,
  newContent: string,
  variableCount?: number
): Promise<boolean> {
  try {
    const newHash = hash(newContent);
    const count =
      variableCount ??
      newContent.split('\n').filter(line => line.trim() && !line.startsWith('#')).length;

    const stateChanged = stateManager.hasServiceChanged(serviceName, newHash);

    let fileNeedsUpdate = false;
    let fileExists = true;
    let diskHash = '';

    try {
      const diskContent = await fs.readFile(filePath, 'utf8');
      diskHash = hash(diskContent);
      fileNeedsUpdate = diskHash !== newHash;
    } catch {
      fileExists = false;
      fileNeedsUpdate = true;
    }

    const changed = stateChanged || fileNeedsUpdate;

    debug(`[CHECK] ${serviceName}: хеш ${newHash.slice(0, 10)}..., диск ${fileExists ? (fileNeedsUpdate ? diskHash.slice(0, 10) : 'OK') : 'нет'}`);
    info(
      `[CHECK] ${serviceName}: ${changed ? 'требуется обновление' : 'без изменений'} (${count} переменных)`
    );

    if (changed) {
      debug(`[CHANGE] ${filePath}: stateChanged=${stateChanged}, fileNeedsUpdate=${fileNeedsUpdate}`);
    }

    return changed;
  } catch (err) {
    error(`Ошибка при проверке изменений: ${(err as Error).message}`);
    return true;
  }
}

/**
 * Обновляет состояние сервиса после записи файла
 *
 * @param serviceName - Имя сервиса
 * @param filePath - Путь к файлу .env
 * @param content - Содержимое файла
 * @param variableCount - Количество переменных
 */
export async function updateServiceState(
  serviceName: string,
  filePath: string,
  content: string,
  variableCount: number
): Promise<void> {
  try {
    const newHash = hash(content);
    await stateManager.updateServiceState(serviceName, filePath, newHash, variableCount);
    debug(`[STATE] ${serviceName}: хеш ${newHash.slice(0, 10)}..., файл ${filePath}`);
    info(`[STATE] Обновлено состояние ${serviceName} (${variableCount} переменных)`);
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
