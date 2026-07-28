import pino from 'pino';
import { LOG_LEVELS, LogLevel } from './types.js';

const containerName = process.env.CONTAINER_NAME || 'infisical-docker-sync';
const prettyLogs = process.env.LOG_FORMAT?.toLowerCase() !== 'json';

export type LogComponent = 'config' | 'docker' | 'infisical' | 'proxy' | 'state' | 'sync' | 'watch';

export interface LogContext {
  component: LogComponent;
  target?: string;
  details?: Record<string, unknown>;
}

export function formatLogMessage(context: LogContext, message: string): string {
  const target = context.target ? ` ${context.target}:` : '';
  return `[${context.component}]${target} ${message}`;
}

const configuredLogLevel = process.env.DEBUG?.toLowerCase() === 'true' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

const logger = pino({
  level: configuredLogLevel,
  base: { service: containerName },
  ...(prettyLogs ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,service,component,target',
        hideObject: false,
        singleLine: true,
      },
    },
  } : {}),
});

function write(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  if (!context) {
    logger[level](message);
    return;
  }
  logger[level]({ component: context.component, target: context.target, ...context.details }, formatLogMessage(context, message));
}

export function setLogLevel(level?: string): void {
  const normalized = level ? (level.toLowerCase() as LogLevel) : LOG_LEVELS.INFO;

  if (Object.values(LOG_LEVELS).includes(normalized as LogLevel)) {
    if (logger.level !== normalized) {
      logger.level = normalized;
      info(`уровень логирования: ${normalized}`, { component: 'config' });
    }
  } else {
    warn(`неизвестный logLevel «${level}» в config.yaml; используется ${LOG_LEVELS.INFO}`, { component: 'config' });
  }
}

export function debug(message: string, context?: LogContext): void { write('debug', message, context); }
export function info(message: string, context?: LogContext): void { write('info', message, context); }
export function warn(message: string, context?: LogContext): void { write('warn', message, context); }
export function error(message: string, context?: LogContext): void { write('error', message, context); }
