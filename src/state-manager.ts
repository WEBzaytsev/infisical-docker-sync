import fs from 'fs/promises';
import path from 'path';
import { AgentState, ServiceState } from './types.js';
import { info, error, warn } from './logger.js';

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
        
        // Выводим краткую информацию о загруженном состоянии
        for (const [serviceName, serviceState] of Object.entries(this.state.services)) {
          info(`[STATE] ${serviceName}: ${serviceState.variableCount} переменных, последняя синхронизация ${serviceState.lastSync}`);
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
      
      info(`[STATE] Состояние сохранено (${Object.keys(this.state.services).length} сервисов)`);
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
      info(`[STATE] Сервис ${serviceName} не найден в состоянии, считаем изменившимся`);
      return true;
    }

    const changed = serviceState.lastHash !== currentHash;
    
    if (changed) {
      info(`[STATE] Сервис ${serviceName} изменился:`);
      info(`  - Старый хеш: ${serviceState.lastHash.slice(0, 10)}...`);
      info(`  - Новый хеш: ${currentHash.slice(0, 10)}...`);
    } else {
      info(`[STATE] Сервис ${serviceName} не изменился (${serviceState.variableCount} переменных)`);
    }

    return changed;
  }

  /**
   * Получает все сохраненные сервисы
   */
  getAllServices(): { [serviceName: string]: ServiceState } {
    return { ...this.state.services };
  }

  /**
   * Удаляет сервис из состояния
   */
  async removeService(serviceName: string): Promise<void> {
    if (this.state.services[serviceName]) {
      const { [serviceName]: removed, ...remainingServices } = this.state.services;
      this.state.services = remainingServices;
      await this.saveState();
      info(`[STATE] Сервис ${serviceName} удален из состояния`);
    }
  }

  /**
   * Очищает все состояние
   */
  async clearState(): Promise<void> {
    this.state = this.createDefaultState();
    await this.saveState();
    info('[STATE] Состояние очищено');
  }
}

// Экспортируем singleton
export const stateManager = new StateManager();
