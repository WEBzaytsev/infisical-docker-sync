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
 * Сравнивает и с StateManager, и с реальным файлом на диске
 *
 * @param serviceName - Имя сервиса для идентификации в состоянии
 * @param filePath - Путь к файлу .env
 * @param newContent - Новое содержимое файла
 * @returns True если файл изменился, не существует или рассинхронизирован с диском
 */
export async function hasChanged(
  serviceName: string,
  filePath: string,
  newContent: string
): Promise<boolean> {
  try {
    const newHash = hash(newContent);
    const variableCount = newContent.split('\n').filter(line => line.trim() && !line.startsWith('#')).length;

    // Проверка 1: Изменился ли хеш в Infisical относительно state
    const stateChanged = stateManager.hasServiceChanged(serviceName, newHash);
    
    // Проверка 2: Соответствует ли файл на диске ожидаемому содержимому
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
    
    info(`[CHECK] Проверка изменений для ${serviceName}:`);
    info(`  - Новый хеш: ${newHash.slice(0, 10)}...`);
    info(`  - Переменных: ${variableCount}`);
    info(`  - Изменился в Infisical: ${stateChanged ? 'ДА' : 'НЕТ'}`);
    info(`  - Файл на диске: ${fileExists ? (fileNeedsUpdate ? 'РАССИНХРОНИЗИРОВАН' : 'ОК') : 'НЕ СУЩЕСТВУЕТ'}`);
    if (fileExists && fileNeedsUpdate) {
      info(`  - Хеш на диске: ${diskHash.slice(0, 10)}...`);
    }
    info(`  - Требуется обновление: ${changed ? 'ДА' : 'НЕТ'}`);

    if (changed) {
      info(`[CHANGE] Файл ${filePath} будет обновлён:`);
      if (stateChanged) {
        info(`  - Причина: изменения в Infisical`);
        info(`  - Старый хеш state: ${stateManager.getServiceState(serviceName)?.lastHash.slice(0, 10) || 'нет'}...`);
      }
      if (fileNeedsUpdate) {
        info(`  - Причина: файл на диске ${fileExists ? 'рассинхронизирован' : 'отсутствует'}`);
      }
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
