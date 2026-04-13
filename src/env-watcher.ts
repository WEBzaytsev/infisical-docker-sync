import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
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

export interface EnvDiff {
  hasDiff: boolean;
  added: string[];
  removed: string[];
  changed: string[];
}

export async function hasChanged(
  serviceName: string,
  filePath: string,
  envVars: EnvVars
): Promise<EnvDiff> {
  try {
    let diskVars: EnvVars = {};
    let diskContent = '';

    debug(`[sync] ${serviceName}: проверяем ${filePath}`);

    try {
      const stat = await fs.stat(filePath);
      debug(
        `[sync] ${serviceName}: файл существует, size=${stat.size}б, mtime=${stat.mtime.toISOString()}`
      );
      diskContent = await fs.readFile(filePath, 'utf8');
      diskVars = parseDotenvContent(diskContent);
      debug(`[sync] ${serviceName}: диск=${Object.keys(diskVars).length} vars, remote=${Object.keys(envVars).length} vars`);
    } catch {
      debug(`[sync] ${serviceName}: файл не найден → создаём`);
      info(`[sync] ${serviceName}: файл не найден, создаём`);
      return { hasDiff: true, added: Object.keys(envVars), removed: [], changed: [] };
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
      const diskHash = crypto.createHash('sha256').update(diskContent).digest('hex').slice(0, 12);
      const remoteContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).sort().join('\n');
      const remoteHash = crypto.createHash('sha256').update(remoteContent).digest('hex').slice(0, 12);
      debug(`[sync] ${serviceName}: хэш диска=${diskHash}, хэш remote=${remoteHash}`);
      info(`[sync] ${serviceName}: без изменений, ${Object.keys(envVars).length} vars`);
    }

    return { hasDiff, added, removed, changed };
  } catch (err) {
    error(`[sync] ${serviceName}: ошибка проверки: ${(err as Error).message}`);
    return { hasDiff: true, added: [], removed: [], changed: [] };
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
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(dir, fsConstants.W_OK);
  } catch {
    throw new Error(`envDir недоступен для записи: ${dir}`);
  }
}
