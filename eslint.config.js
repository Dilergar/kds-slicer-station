/**
 * eslint.config.js — Конфигурация линтера ESLint
 *
 * Минимальная конфигурация для TypeScript + React проекта.
 * Использует рекомендуемые правила TypeScript.
 * Запуск: npm run lint
 */

import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        Array: 'readonly',
        JSON: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        FileReader: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        process: 'readonly',
        alert: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      // Отключаем конфликтующие с TS правила
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off', // TS сам проверяет типы
    }
  },
  {
    ignores: ['node_modules/', 'dist/']
  }
];
