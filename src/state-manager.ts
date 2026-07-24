import fs from 'fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'path';
import { AgentState, ServiceState } from './types.js';
import { info, error, warn, debug } from './logger.js';

const DEFAULT_STATE_FILE = '/app/data/agent-state.json';
const STATE_VERSION = '1.0.0';

export class StateManager {
  private state: AgentState;
  private readonly stateFile: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(stateFile = DEFAULT_STATE_FILE) {
    this.stateFile = stateFile;
    this.state = this.createDefaultState();
  }

  private createDefaultState(): AgentState {
    return {
      version: STATE_VERSION,
      lastUpdate: new Date().toISOString(),
      services: {},
    };
  }

  async loadState(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });

      try {
        const stateData = await fs.readFile(this.stateFile, 'utf8');
        const loadedState = JSON.parse(stateData) as AgentState;

        if (loadedState.version !== STATE_VERSION) {
          warn(`[state] Версия состояния ${loadedState.version} устарела (ожидается ${STATE_VERSION}) — сброс`);
          this.state = this.createDefaultState();
          await this.saveState();
          return;
        }

        this.state = loadedState;
        const count = Object.keys(this.state.services).length;
        info(`[state] Загружено состояние синхронизации: ${count} сервисов`);
        for (const [name, s] of Object.entries(this.state.services)) {
          debug(`[state] ${name}: ${s.variableCount} vars, ${s.lastSync}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          info('[state] Файл состояния не найден — начнём с чистого');
        } else {
          warn(`[state] Не удалось прочитать файл состояния: ${(err as Error).message}`);
        }
        this.state = this.createDefaultState();
        await this.saveState();
      }
    } catch (err) {
      error(`[state] Критическая ошибка состояния: ${(err as Error).message}`);
      this.state = this.createDefaultState();
    }
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queued = this.writeQueue.then(operation);
    this.writeQueue = queued.catch(() => undefined);
    return queued;
  }

  async saveState(): Promise<void> {
    await this.enqueueWrite(() => this.saveStateNow());
  }

  private async saveStateNow(): Promise<void> {
    const tmpPath = `${this.stateFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      this.state.lastUpdate = new Date().toISOString();
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(tmpPath, this.stateFile);
      debug(`[state] Сохранено (${Object.keys(this.state.services).length} сервисов)`);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      error(`[state] Не удалось сохранить состояние синхронизации: ${(err as Error).message}`);
      throw err;
    }
  }

  getServiceState(serviceName: string): ServiceState | undefined {
    return this.state.services[serviceName];
  }

  async updateServiceState(
    serviceName: string,
    envFilePath: string,
    hash: string,
    variableCount: number,
    pendingRemovedKeys?: string[],
  ): Promise<void> {
    const existing = this.state.services[serviceName];
    this.state.services[serviceName] = {
      envFilePath,
      lastHash: hash,
      lastSync: new Date().toISOString(),
      variableCount,
      pendingRecreate: pendingRemovedKeys === undefined
        ? existing?.pendingRecreate
        : { removedKeys: [...new Set(pendingRemovedKeys)] },
    };
    await this.saveState();
    debug(`[sync] ${serviceName}: состояние обновлено`);
  }

  getPendingRecreate(serviceName: string): ServiceState['pendingRecreate'] {
    return this.state.services[serviceName]?.pendingRecreate;
  }

  async markRecreatePending(serviceName: string, removedKeys: string[]): Promise<void> {
    const serviceState = this.state.services[serviceName];
    if (!serviceState) {
      throw new Error(`[state] ${serviceName}: нельзя отметить pending recreate без состояния сервиса`);
    }

    serviceState.pendingRecreate = { removedKeys: [...new Set(removedKeys)] };
    await this.saveState();
  }

  async clearPendingRecreate(serviceName: string): Promise<void> {
    const serviceState = this.state.services[serviceName];
    if (!serviceState?.pendingRecreate) return;

    delete serviceState.pendingRecreate;
    await this.saveState();
  }

  hasServiceChanged(serviceName: string, currentHash: string): boolean {
    const serviceState = this.getServiceState(serviceName);
    if (!serviceState) {
      debug(`[state] ${serviceName}: нет в состоянии, считаем изменённым`);
      return true;
    }
    const changed = serviceState.lastHash !== currentHash;
    debug(`[state] ${serviceName}: ${changed ? 'изменился' : 'без изменений'}`);
    return changed;
  }
}

export const stateManager = new StateManager();
