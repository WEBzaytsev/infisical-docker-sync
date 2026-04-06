import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { info, error, debug } from './logger.js';
import { stateManager } from './state-manager.js';
import { parseDotenvContent } from './env-format.js';
import { EnvVars } from './types.js';

function diffEnvVars(
  disk: EnvVars,
  remote: EnvVars
): { added: string[]; removed: string[]; changed: string[] } {
  const diskKeys = new Set(Object.keys(disk));
  const remoteKeys = new Set(Object.keys(remote));

  const added = [...remoteKeys].filter(k => !diskKeys.has(k));
  const removed = [...diskKeys].filter(k => !remoteKeys.has(k));
  const changed = [...remoteKeys].filter(
    k => diskKeys.has(k) && disk[k] !== remote[k]
  );

  return { added, removed, changed };
}

export async function hasChanged(
  serviceName: string,
  filePath: string,
  envVars: EnvVars
): Promise<boolean> {
  try {
    let diskVars: EnvVars = {};

    try {
      const diskContent = await fs.readFile(filePath, 'utf8');
      diskVars = parseDotenvContent(diskContent);
    } catch {
      info(`[sync] ${serviceName}: файл не найден, создаём`);
      return true;
    }

    const { added, removed, changed } = diffEnvVars(diskVars, envVars);
    const hasDiff = added.length > 0 || removed.length > 0 || changed.length > 0;

    if (hasDiff) {
      if (added.length > 0) debug(`[sync] ${serviceName}: +${added.join(', +')}`);
      if (removed.length > 0) debug(`[sync] ${serviceName}: -${removed.join(', -')}`);
      if (changed.length > 0) debug(`[sync] ${serviceName}: ~${changed.join(', ~')}`);
      info(
        `[sync] ${serviceName}: изменений ${added.length + removed.length + changed.length} (+ ${added.length} - ${removed.length} ~ ${changed.length})`
      );
    } else {
      info(`[sync] ${serviceName}: без изменений, ${Object.keys(envVars).length} vars`);
    }

    return hasDiff;
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
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    await stateManager.updateServiceState(serviceName, filePath, hash, variableCount);
    debug(`[sync] ${serviceName}: состояние обновлено`);
  } catch (err) {
    error(`[sync] ${serviceName}: ошибка обновления состояния: ${(err as Error).message}`);
  }
}

export async function ensureEnvDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
