import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { info, error, debug } from './logger.js';
import { stateManager } from './state-manager.js';

function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function hasChanged(
  serviceName: string,
  filePath: string,
  newContent: string,
  variableCount: number
): Promise<boolean> {
  try {
    const newHash = hash(newContent);
    const stateChanged = stateManager.hasServiceChanged(serviceName, newHash);

    let fileNeedsUpdate = false;
    let fileExists = true;

    try {
      const diskContent = await fs.readFile(filePath, 'utf8');
      fileNeedsUpdate = hash(diskContent) !== newHash;
    } catch {
      fileExists = false;
      fileNeedsUpdate = true;
    }

    const changed = stateChanged || fileNeedsUpdate;

    if (changed) {
      debug(`[sync] ${serviceName}: state=${stateChanged}, file=${fileNeedsUpdate}, exists=${fileExists}`);
    }
    info(`[sync] ${serviceName}: ${changed ? 'обновление' : 'без изменений'}, ${variableCount} vars`);

    return changed;
  } catch (err) {
    error(`[sync] ${serviceName}: ошибка проверки: ${(err as Error).message}`);
    return true;
  }
}

export async function updateServiceState(
  serviceName: string,
  filePath: string,
  content: string,
  variableCount: number
): Promise<void> {
  try {
    const newHash = hash(content);
    await stateManager.updateServiceState(serviceName, filePath, newHash, variableCount);
    debug(`[sync] ${serviceName}: состояние обновлено, hash=${newHash.slice(0, 10)}`);
  } catch (err) {
    error(`[sync] ${serviceName}: ошибка обновления состояния: ${(err as Error).message}`);
  }
}

export async function ensureEnvDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
