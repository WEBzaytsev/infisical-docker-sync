import pino from 'pino';
import { LOG_LEVELS, LogLevel } from './types.js';

// Получаем имя контейнера из переменной окружения или используем дефолт
const containerName = process.env.CONTAINER_NAME || 'infisical-docker-sync';

// Создаем экземпляр pino логгера
const logger = pino({
  level: LOG_LEVELS.INFO,
  base: { service: containerName }, // добавляем имя сервиса
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,
      messageFormat: `[${containerName}] {msg}`, // префикс с именем сервиса
    },
  },
});

// Устанавливает уровень логирования для приложения
export function setLogLevel(level?: string): void {
  const normalizedLevel = level
    ? (level.toLowerCase() as LogLevel)
    : LOG_LEVELS.INFO;

  // Проверяем, что переданный уровень поддерживается
  if (Object.values(LOG_LEVELS).includes(normalizedLevel as LogLevel)) {
    logger.level = normalizedLevel;
    // Вывод информации об уровне логирования всегда отображается
    logger.info(`Установлен уровень логирования: ${normalizedLevel}`);
  } else {
    logger.warn(
      `Неизвестный уровень логирования: ${level}, используется уровень по умолчанию: ${LOG_LEVELS.INFO}`
    );
  }
}

// Функция для логирования отладочной информации
export function debug(message: string): void {
  logger.debug(message);
}

// Функция для логирования информационных сообщений
export function info(message: string): void {
  logger.info(message);
}

// Функция для логирования предупреждений
export function warn(message: string): void {
  logger.warn(message);
}

// Функция для логирования ошибок
export function error(message: string): void {
  logger.error(message);
}

// Экспортируем сам логгер для прямого использования при необходимости
export { logger };

// Экспортируем типы для обратной совместимости
export { LOG_LEVELS };
