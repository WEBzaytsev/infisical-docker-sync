import globals from 'globals';
import { baseConfig } from './eslint.base.config.js';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

/**
 * Строгая ESLint конфигурация для Node.js приложений
 * @type {import("eslint").Linter.Config[]}
 */
export const nodeConfig = [
  ...baseConfig,
  // Включаем typed-linting (TypeScript type-aware) через projectService
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // === Предпочтения синтаксиса ===
      // Предпочитаем optional chaining вместо && для проверок на null/undefined
      '@typescript-eslint/prefer-optional-chain': 'error',
      // Предпочитаем шаблонные строки вместо конкатенации
      'prefer-template': 'error',
      // Запрещаем конкатенацию только строковых литералов
      'no-useless-concat': 'error',

      // === Условия и логика ===
      // Запрещаем константные условия, но разрешаем бесконечные циклы while(true)
      'no-constant-condition': ['error', { checkLoops: false }],
      // Запрещаем присваивания внутри условий
      'no-cond-assign': ['error', 'always'],
      // Запрещаем константные бинарные выражения
      'no-constant-binary-expression': 'error',
      
      // === TypeScript строгие правила ===
      // Отключаем "лишние условия" ради снижения шума
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // === Node.js специфичные правила ===
      // Смягчаем некоторые TS‑правила для Node.js
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'warn', // warning вместо error
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      
      // === ES6 и современный JavaScript ===
      // ES6 шорткаты для свойств/методов объектов
      'object-shorthand': ['error', 'always'],
      
      // === Переменные и неиспользуемые элементы ===
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // === Качество кода ===
      // Запрещаем console в production (можно настроить через env)
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      
      // === Асинхронный код ===
      // Требуем await в async функциях
      '@typescript-eslint/require-await': 'warn',
      // Запрещаем плавающие промисы
      '@typescript-eslint/no-floating-promises': 'error',
      
      // === Безопасность ===
      // Запрещаем eval и подобные
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    plugins: { unicorn },
    rules: {
      // === Unicorn правила для Node.js ===
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'unicorn/no-null': 'off', // В Node.js null часто используется
      'unicorn/prefer-module': 'error', // Предпочитаем ES modules
      'unicorn/prefer-node-protocol': 'error', // node: протокол для встроенных модулей
    },
  },
];
