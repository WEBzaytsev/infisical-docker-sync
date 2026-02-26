import fs from 'fs/promises';
import path from 'path';
import { AgentState, ServiceState } from './types.js';
import { info, error, warn, debug } from './logger.js';

const STATE_FILE = '/app/data/agent-state.json';
const STATE_VERSION = '1.0.0';

export class StateManager {
  private state: AgentState;

  constructor() {
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
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });

      try {
        const stateData = await fs.readFile(STATE_FILE, 'utf8');
        const loadedState = JSON.parse(stateData) as AgentState;

        if (loadedState.version !== STATE_VERSION) {
          warn(`[state] Версия ${loadedState.version} != ${STATE_VERSION}, сброс`);
          this.state = this.createDefaultState();
          await this.saveState();
          return;
        }

        this.state = loadedState;
        const count = Object.keys(this.state.services).length;
        info(`[state] Загружено состояние: ${count} сервисов`);
        for (const [name, s] of Object.entries(this.state.services)) {
          debug(`[state] ${name}: ${s.variableCount} vars, ${s.lastSync}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          info('[state] Файл состояния не найден, создаём новое');
        } else {
          warn(`[state] Ошибка чтения: ${(err as Error).message}`);
        }
        this.state = this.createDefaultState();
        await this.saveState();
      }
    } catch (err) {
      error(`[state] Критическая ошибка: ${(err as Error).message}`);
      this.state = this.createDefaultState();
    }
  }

  async saveState(): Promise<void> {
    try {
      this.state.lastUpdate = new Date().toISOString();
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      await fs.writeFile(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
      debug(`[state] Сохранено (${Object.keys(this.state.services).length} сервисов)`);
    } catch (err) {
      error(`[state] Ошибка сохранения: ${(err as Error).message}`);
    }
  }

  getServiceState(serviceName: string): ServiceState | undefined {
    return this.state.services[serviceName];
  }

  async updateServiceState(
    serviceName: string,
    envFilePath: string,
    hash: string,
    variableCount: number
  ): Promise<void> {
    this.state.services[serviceName] = {
      envFilePath,
      lastHash: hash,
      lastSync: new Date().toISOString(),
      variableCount,
    };
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
