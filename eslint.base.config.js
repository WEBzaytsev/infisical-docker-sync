import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import onlyWarn from 'eslint-plugin-only-warn';
import unicorn from 'eslint-plugin-unicorn';

/**
 * Базовая строгая ESLint конфигурация
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const baseConfig = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      unicorn,
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      // === Импорты/экспорты ===
      'import/export': 'error',
      'no-duplicate-imports': ['error', { includeExports: true }],

      // === Безопасность управления процессом ===
      'no-process-exit': 'error',

      // === Запрещаем void оператор ===
      // Разрешаем void как statement для игнорирования async результатов
      'no-void': ['error', { allowAsStatement: true }],

      // === Запрещаем бесполезные template literals ===
      // Пример: const msg = `Hello` → const msg = 'Hello'
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'TemplateLiteral[expressions.length=0][quasis.length=1]:not(:has(TemplateElement[value.raw=/[\\n\\r]/]))',
          message: 'Template string can be replaced with a regular string literal',
        },
      ],

      // === Явные приведения типов ===
      'no-implicit-coercion': [
        'error',
        {
          boolean: true,
          number: true,
          string: true,
          disallowTemplateShorthand: false,
        },
      ],

      // === Unicorn правила (консервативные) ===
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-useless-undefined': 'off',
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    rules: {
      // === TypeScript строгие правила ===
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-explicit-any': 'warn', // warning для постепенной типизации
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-extraneous-class': [
        'error',
        {
          allowEmpty: false,
          allowConstructorOnly: false,
          allowStaticOnly: false,
          allowWithDecorator: true,
        },
      ],

      // === Именование переменных ===
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'method', format: ['camelCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: ['property', 'classProperty', 'objectLiteralProperty', 'typeProperty'], format: null },
        {
          selector: [
            'classProperty',
            'objectLiteralProperty',
            'typeProperty',
            'classMethod',
            'objectLiteralMethod',
            'typeMethod',
            'accessor',
            'enumMember',
          ],
          format: null,
          modifiers: ['requiresQuotes'],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.d.ts'],
  },
];
