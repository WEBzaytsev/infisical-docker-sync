// Доступные уровни логирования
export const LOG_LEVELS = {
  DEBUG: 'debug',  // Подробное логирование
  INFO: 'info',    // Стандартный уровень
  NONE: 'none'     // Минимальное логирование
};

// Текущий уровень логирования (по умолчанию INFO)
let currentLogLevel = LOG_LEVELS.INFO;

// Устанавливает уровень логирования для приложения
export function setLogLevel(level) {
  const normalizedLevel = level ? level.toLowerCase() : LOG_LEVELS.INFO;
  
  // Проверяем, что переданный уровень поддерживается
  if (Object.values(LOG_LEVELS).includes(normalizedLevel)) {
    currentLogLevel = normalizedLevel;
    // Вывод информации об уровне логирования всегда отображается
    console.log(`🔧 Установлен уровень логирования: ${currentLogLevel}`);
  } else {
    console.warn(`⚠️ Неизвестный уровень логирования: ${level}, используется уровень по умолчанию: ${currentLogLevel}`);
  }
}

// Функция для логирования отладочной информации
export function debug(message, ...args) {
  if (currentLogLevel === LOG_LEVELS.DEBUG) {
    console.log(`🐞 ${message}`, ...args);
  }
}

// Функция для логирования информационных сообщений
export function info(message, ...args) {
  if (currentLogLevel === LOG_LEVELS.DEBUG || currentLogLevel === LOG_LEVELS.INFO) {
    console.log(message, ...args);
  }
}

// Функция для логирования предупреждений (всегда отображаются, кроме NONE)
export function warn(message, ...args) {
  if (currentLogLevel !== LOG_LEVELS.NONE) {
    console.warn(`⚠️ ${message}`, ...args);
  }
}

// Функция для логирования ошибок (всегда отображаются)
export function error(message, ...args) {
  console.error(`❌ ${message}`, ...args);
} 