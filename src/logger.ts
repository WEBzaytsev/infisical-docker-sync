import pino from 'pino';
import { LOG_LEVELS, LogLevel } from './types.js';

const containerName = process.env.CONTAINER_NAME || 'infisical-docker-sync';

const logger = pino({
  level: LOG_LEVELS.INFO,
  base: { service: containerName },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,
      messageFormat: `[${containerName}] {msg}`,
    },
  },
});

export function setLogLevel(level?: string): void {
  const normalized = level ? (level.toLowerCase() as LogLevel) : LOG_LEVELS.INFO;

  if (Object.values(LOG_LEVELS).includes(normalized as LogLevel)) {
    if (logger.level !== normalized) {
      logger.level = normalized;
      logger.info(`Уровень логирования: ${normalized}`);
    }
  } else {
    logger.warn(`Неизвестный уровень логирования: ${level}, используется ${LOG_LEVELS.INFO}`);
  }
}

export function debug(message: string): void { logger.debug(message); }
export function info(message: string): void { logger.info(message); }
export function warn(message: string): void { logger.warn(message); }
export function error(message: string): void { logger.error(message); }
