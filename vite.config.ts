/**
 * vite.config.ts — Конфигурация сборщика Vite
 *
 * Настройки:
 * - Dev-сервер на порту 3000, доступен из локальной сети (host: 0.0.0.0)
 * - Плагин React для HMR (Hot Module Replacement)
 * - Прокидывание переменных окружения GEMINI_API_KEY
 * - Алиас @ для импортов от корня проекта
 */

import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // Загружаем переменные окружения из .env.local
    const env = loadEnv(mode, process.cwd(), '');
    return {
      // Настройки dev-сервера
      server: {
        port: 3000,       // Порт для localhost
        host: '0.0.0.0',  // Открыть для локальной сети (доступ с других устройств)
      },
      // Плагины (React для JSX/TSX и HMR)
      plugins: [react()],
      // Глобальные переменные (доступны через process.env.*)
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      // Алиасы путей (@ = корень проекта)
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
