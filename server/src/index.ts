/**
 * index.ts — Точка входа backend-сервера модуля нарезчика (Slicer Station).
 *
 * Express-сервер на порту 3001, подключается к PostgreSQL (arclient).
 * Фронтенд (Vite, порт 3000) проксирует /api → localhost:3001.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { testConnection } from './config/db';
import { errorHandler } from './middleware/errorHandler';

// Маршруты
import categoriesRouter from './routes/categories';
import ingredientsRouter from './routes/ingredients';
import settingsRouter from './routes/settings';
import ordersRouter from './routes/orders';
import stoplistRouter from './routes/stoplist';
import recipesRouter from './routes/recipes';
import historyRouter from './routes/history';
import dishesRouter from './routes/dishes';
import dishAliasesRouter from './routes/dishAliases';
import authRouter from './routes/auth';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001');

// === Middleware ===
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Увеличен лимит для Base64 изображений

// === Статика: фото блюд (/images/dishes/...) ===
// Файлы загружаются multer'ом в server/public/images/dishes/ (см. routes/dishes.ts).
// В dev Vite проксирует /images → сюда; в проде nginx раздаёт напрямую с диска.
app.use('/images', express.static(path.resolve(__dirname, '../public/images'), {
  maxAge: '7d',       // Браузер кэширует картинки на неделю — картинки редко меняются.
  fallthrough: false  // 404 вместо передачи дальше по цепочке middleware.
}));

// === API маршруты ===
app.use('/api/categories', categoriesRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/stoplist', stoplistRouter);
app.use('/api/recipes', recipesRouter);
app.use('/api/history', historyRouter);
app.use('/api/dishes', dishesRouter);
app.use('/api/dish-aliases', dishAliasesRouter);
app.use('/api/auth', authRouter);

// === Проверка здоровья сервера ===
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// === Обработчик ошибок (должен быть последним) ===
app.use(errorHandler);

// === Запуск сервера ===
async function start() {
  try {
    // Проверяем подключение к БД перед стартом
    await testConnection();

    app.listen(PORT, () => {
      console.log(`[Server] Slicer Station API запущен на порту ${PORT}`);
      console.log(`[Server] Эндпоинты: http://localhost:${PORT}/api/`);
    });
  } catch (err) {
    console.error('[Server] Не удалось запустить сервер:', err);
    process.exit(1);
  }
}

start();
