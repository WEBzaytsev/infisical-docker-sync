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

    debug(`проверяем ${filePath}`, { component: 'sync', target: serviceName });

    try {
      const stat = await fs.stat(filePath);
      debug(`файл существует, size=${stat.size}б, mtime=${stat.mtime.toISOString()}`, { component: 'sync', target: serviceName });
      diskContent = await fs.readFile(filePath, 'utf8');
      diskVars = parseDotenvContent(diskContent);
      debug(`диск=${Object.keys(diskVars).length} vars, Infisical=${Object.keys(envVars).length} vars`, { component: 'sync', target: serviceName });
    } catch {
      debug('файл не найден', { component: 'sync', target: serviceName });
      info('.env отсутствует — создаём из секретов Infisical', { component: 'sync', target: serviceName });
      return { hasDiff: true, added: Object.keys(envVars), removed: [], changed: [] };
    }

    const { added, removed, changed } = diffEnvVars(diskVars, envVars);
    const hasDiff = added.length > 0 || removed.length > 0 || changed.length > 0;

    if (hasDiff) {
      if (added.length > 0) debug(`добавлены: ${added.join(', ')}`, { component: 'sync', target: serviceName });
      if (removed.length > 0) debug(`удалены: ${removed.join(', ')}`, { component: 'sync', target: serviceName });
      if (changed.length > 0) debug(`изменены: ${changed.join(', ')}`, { component: 'sync', target: serviceName });
      info(
        `секреты изменились (+${added.length} −${removed.length} ~${changed.length}), обновляем .env`,
        { component: 'sync', target: serviceName },
      );
    } else {
      const diskHash = crypto.createHash('sha256').update(diskContent).digest('hex').slice(0, 12);
      const remoteContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).sort().join('\n');
      const remoteHash = crypto.createHash('sha256').update(remoteContent).digest('hex').slice(0, 12);
      debug(`секреты актуальны (${Object.keys(envVars).length} переменных); хэш диска=${diskHash}, Infisical=${remoteHash}`, { component: 'sync', target: serviceName });
    }

    return { hasDiff, added, removed, changed };
  } catch (err) {
    error(`не удалось сравнить .env с Infisical: ${(err as Error).message}`, { component: 'sync', target: serviceName });
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
    debug('состояние обновлено', { component: 'sync', target: serviceName });
  } catch (err) {
    error(`не удалось сохранить состояние синхронизации: ${(err as Error).message}`, { component: 'sync', target: serviceName });
  }
}

interface FileOwner {
  uid: number;
  gid: number;
}

function parseEnvFileOwner(owner?: string): FileOwner | undefined {
  if (!owner) return undefined;
  const [uid, gid] = owner.split(':').map(Number);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
    throw new Error(`Некорректный envFileOwner «${owner}», ожидается uid:gid`);
  }
  return { uid, gid };
}

async function getExistingEnvFileOwner(filePath: string): Promise<FileOwner | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Отказ от записи в ${filePath}: целевой .env — символическая ссылка`);
    }
    if (!stat.isFile()) {
      throw new Error(`Отказ от записи в ${filePath}: целевой путь не является обычным файлом`);
    }
    return { uid: stat.uid, gid: stat.gid };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function chownIfRoot(filePath: string, owner?: FileOwner): Promise<void> {
  if (!owner || process.getuid?.() !== 0) return;
  await fs.chown(filePath, owner.uid, owner.gid);
}

export async function writeEnvFileSafely(
  serviceName: string,
  filePath: string,
  content: string,
  configuredOwner?: string
): Promise<void> {
  const dir = path.dirname(filePath);
  const existingOwner = await getExistingEnvFileOwner(filePath);
  const owner = parseEnvFileOwner(configuredOwner) || existingOwner;
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );

  try {
    await fs.writeFile(tmpPath, content, { mode: 0o600, flag: 'wx' });
    await fs.chmod(tmpPath, 0o600);
    await chownIfRoot(tmpPath, owner);
    await fs.rename(tmpPath, filePath);
    debug(`.env записан атомарно → ${filePath}`, { component: 'sync', target: serviceName });
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function ensureEnvDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const uid = process.getuid?.() ?? '?';
  const gid = process.getgid?.() ?? '?';
  debug(`процесс: uid=${uid}, gid=${gid}`, { component: 'sync' });

  try {
    const dirStat = await fs.stat(dir);
    const mode = (dirStat.mode & 0o777).toString(8);
    debug(`директория ${dir}: uid=${dirStat.uid}, gid=${dirStat.gid}, mode=0${mode}`, { component: 'sync' });
  } catch {
    // stat не критичен
  }

  try {
    await fs.access(dir, fsConstants.W_OK);
    debug(`директория ${dir}: доступ на запись OK`, { component: 'sync' });
  } catch {
    throw new Error(
      `Нет прав на запись в envDir (${dir}). Проверьте монтирование volume в compose агента и user (uid=${uid}, gid=${gid})`
    );
  }

  try {
    await fs.access(filePath, fsConstants.F_OK);
    const fileStat = await fs.stat(filePath);
    const mode = (fileStat.mode & 0o777).toString(8);
    debug(`файл ${filePath}: uid=${fileStat.uid}, gid=${fileStat.gid}, mode=0${mode}`, { component: 'sync' });
    await fs.access(filePath, fsConstants.W_OK);
    debug(`файл ${filePath}: доступ на запись OK`, { component: 'sync' });
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).message;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug(`файл ${filePath}: нет доступа на запись — ${msg}`, { component: 'sync' });
    }
  }
}
