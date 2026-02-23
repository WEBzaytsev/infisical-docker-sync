import fs from 'fs/promises';
import path from 'path';
import { AgentState, ServiceState } from './types.js';
import { info, error, warn, debug } from './logger.js';

const STATE_FILE = '/app/data/agent-state.json';
const STATE_VERSION = '1.0.0';

/**
 * Менеджер состояния агента для персистентности между перезагрузками
 */
export class StateManager {
  private state: AgentState;

  constructor() {
    this.state = this.createDefaultState();
  }

  /**
   * Создает состояние по умолчанию
   */
  private createDefaultState(): AgentState {
    return {
      version: STATE_VERSION,
      lastUpdate: new Date().toISOString(),
      services: {},
    };
  }

  /**
   * Загружает состояние из файла
   */
  async loadState(): Promise<void> {
    try {
      // Создаем директорию для данных если не существует
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });

      try {
        const stateData = await fs.readFile(STATE_FILE, 'utf8');
        const loadedState = JSON.parse(stateData) as AgentState;

        // Проверяем версию состояния
        if (loadedState.version !== STATE_VERSION) {
          warn(`[STATE] Версия состояния ${loadedState.version} не совпадает с текущей ${STATE_VERSION}, сбрасываем состояние`);
          this.state = this.createDefaultState();
          await this.saveState();
          return;
        }

        this.state = loadedState;
        info(`[STATE] Состояние загружено (${Object.keys(this.state.services).length} сервисов)`);
        for (const [serviceName, serviceState] of Object.entries(this.state.services)) {
          debug(`[STATE] ${serviceName}: ${serviceState.variableCount} переменных, ${serviceState.lastSync}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          info('[STATE] Файл состояния не найден, создаем новое состояние');
        } else {
          warn(`[STATE] Ошибка чтения файла состояния: ${(err as Error).message}, создаем новое состояние`);
        }
        
        this.state = this.createDefaultState();
        await this.saveState();
      }
    } catch (err) {
      error(`[STATE] Критическая ошибка при загрузке состояния: ${(err as Error).message}`);
      this.state = this.createDefaultState();
    }
  }

  /**
   * Сохраняет состояние в файл
   */
  async saveState(): Promise<void> {
    try {
      this.state.lastUpdate = new Date().toISOString();
      
      // Создаем директорию если не существует
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      
      const stateData = JSON.stringify(this.state, null, 2);
      await fs.writeFile(STATE_FILE, stateData, 'utf8');
      debug(`[STATE] Состояние сохранено (${Object.keys(this.state.services).length} сервисов)`);
    } catch (err) {
      error(`[STATE] Ошибка сохранения состояния: ${(err as Error).message}`);
    }
  }

  /**
   * Получает состояние сервиса
   */
  getServiceState(serviceName: string): ServiceState | undefined {
    return this.state.services[serviceName];
  }

  /**
   * Обновляет состояние сервиса
   */
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

  /**
   * Проверяет, изменился ли хеш сервиса
   */
  hasServiceChanged(serviceName: string, currentHash: string): boolean {
    const serviceState = this.getServiceState(serviceName);

    if (!serviceState) {
      debug(`[STATE] Сервис ${serviceName} не найден в состоянии, считаем изменившимся`);
      return true;
    }

    const changed = serviceState.lastHash !== currentHash;
    debug(
      `[STATE] ${serviceName}: ${changed ? 'изменился' : 'без изменений'} (${serviceState.variableCount} переменных)`
    );
    return changed;
  }
}

// Экспортируем singleton
export const stateManager = new StateManager();
