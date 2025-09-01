import { nodeConfig } from './eslint.node.config.js';

/**
 * Основная ESLint конфигурация проекта
 * Использует строгие правила для Node.js приложений
 */
export default [
  ...nodeConfig,
  {
    // Специфичные настройки для этого проекта
    files: ['src/**/*.ts'],
    rules: {
      // Отключаем filename-case для TypeScript файлов
      'unicorn/filename-case': 'off',
      
      // Более мягкие правила для логирования в Node.js проекте
      'no-console': 'off',
      
      // Настройка для максимальной длины строки
      'max-len': ['warn', { 
        code: 120,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      }],
      
      // Разрешаем использование node: протокола
      'unicorn/prefer-node-protocol': 'off', // отключаем для совместимости
    },
  },
  {
    // Настройки для конфигурационных файлов
    files: ['*.js', '*.mjs', 'eslint.*.js'],
    rules: {
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      '@typescript-eslint/naming-convention': 'off',
      'unicorn/filename-case': 'off',
    },
  },
];
