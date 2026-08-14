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
//
// CORS. Раньше стоял голый `cors()`, то есть Access-Control-Allow-Origin: *
// и разрешение любых заголовков в preflight: JSON-запросы POST/PUT/DELETE
// проходили С ЛЮБОГО стороннего сайта, открытого в браузере на устройстве
// в сети ресторана. Доступ к самому планшету при этом не требовался. Модуль
// не проверяет роли на write-эндпоинтах (осознанное решение заказчика), так что
// открытый CORS превращал «планшет без пароля» в «любая вкладка в сети».
//
// CORS_ORIGINS — список через запятую; по умолчанию свои же адреса (в проде
// фронт раздаётся с того же хоста через nginx, и заголовок вообще не нужен).
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '5mb' })); // Увеличен лимит для Base64 изображений

// === Статика: фото блюд (/images/dishes/...) ===
// Файлы загружаются multer'ом в server/public/images/dishes/ (см. routes/dishes.ts).
// В dev Vite проксирует /images → сюда; в проде nginx раздаёт напрямую с диска.
app.use('/images', express.static(path.resolve(__dirname, '../public/images'), {
  maxAge: '7d',       // Браузер кэширует картинки на неделю — картинки редко меняются.
  fallthrough: false, // 404 вместо передачи дальше по цепочке middleware.
  setHeaders: (res) => {
    // Браузер не должен «угадывать» тип по содержимому: если в папку когда-нибудь
    // попадёт файл с не тем расширением, он не выполнится как HTML/скрипт
    // на том же origin, что и приложение.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
  }
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

    // Интерфейс прослушивания. По умолчанию 127.0.0.1: в проде фронт и API
    // раздаёт nginx с той же машины (см. Инструкция.md, раздел 7), и держать
    // порт 3001 открытым на всю подсеть незачем — модуль не проверяет роли на
    // write-эндпоинтах, а /api/auth/login отвечает по чужим PIN-ам.
    // Если backend и nginx на разных машинах — задайте SERVER_HOST=0.0.0.0
    // и обязательно закройте 3001 на фаерволе для всех, кроме адреса nginx.
    const HOST = process.env.SERVER_HOST || '127.0.0.1';
    app.listen(PORT, HOST, () => {
      console.log(`[Server] Slicer Station API запущен на ${HOST}:${PORT}`);
      console.log(`[Server] Эндпоинты: http://${HOST}:${PORT}/api/`);
    });
  } catch (err) {
    console.error('[Server] Не удалось запустить сервер:', err);
    process.exit(1);
  }
}

start();
