/**
 * Конфигурация подключения к PostgreSQL (база arclient).
 * Используется пул соединений для эффективной работы с множественными запросами.
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Часовой пояс ресторана.
 *
 * ЗАЧЕМ ЗАДАВАТЬ ЯВНО. Чужие колонки времени (`docm2tabl1_ordertime`,
 * `docm2tabl1_cooktime`, `rgst3_dishstoplist.insert_date`) имеют тип TIMESTAMP
 * БЕЗ часового пояса, а все наши slicer_*-колонки — TIMESTAMPTZ. Когда SQL
 * сравнивает или вычитает одно из другого, PostgreSQL приводит наивное значение
 * к зоне СЕССИИ. Пока Node и PostgreSQL на одной машине, зоны совпадают и всё
 * сходится. Но если заказчик поднимет backend в Docker (там по умолчанию UTC),
 * а базу оставит в +05, метрика «скорость готовки повара» (cooktime − finished_at)
 * уедет ровно на разницу поясов: отчёт покажет «≈5 часов» вместо «4 минуты».
 * Ошибки при этом не будет — просто все цифры станут неправдой.
 *
 * Меняется под ресторан вместе с KITCHEN_STORAGE_UUIDS (см. Инструкция.md).
 */
const RESTAURANT_TIMEZONE = process.env.DB_TIMEZONE || 'Asia/Almaty';

/**
 * Предел выполнения одного запроса, мс.
 *
 * Наши 20 соединений берутся из общего max_connections продакшн-сервера
 * заказчика. Без предела один случайно тяжёлый запрос держит соединение
 * сколько угодно; несколько таких — и их системе не хватает коннектов.
 */
const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000');

/** Предел «висящей» открытой транзакции, мс — страховка от забытого COMMIT */
const IDLE_TX_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TX_TIMEOUT_MS || '30000');

// Пароль БД обязателен и берётся ТОЛЬКО из окружения.
// Раньше здесь стоял фолбэк `|| '1234'` — стендовое значение. При незаполненном
// .env приложение молча пробовало его вместо того чтобы упасть с внятной
// ошибкой конфигурации, и у заказчика это выглядело бы как «БД не отвечает».
if (!process.env.DB_PASSWORD) {
  console.error(
    '[DB] Не задан DB_PASSWORD. Создайте server/.env по образцу server/.env.example ' +
    'и укажите пароль пользователя БД.'
  );
  process.exit(1);
}

/** Пул соединений к БД arclient */
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'arclient',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,               // Максимум соединений в пуле
  idleTimeoutMillis: 30000,  // Закрывать неактивные через 30 сек
  connectionTimeoutMillis: 2000,  // Таймаут подключения 2 сек
  // Параметры сессии применяются к КАЖДОМУ соединению пула при его создании
  options: [
    `-c timezone=${RESTAURANT_TIMEZONE}`,
    `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
    `-c idle_in_transaction_session_timeout=${IDLE_TX_TIMEOUT_MS}`,
  ].join(' ')
});

/**
 * Обработчик ошибок простаивающих соединений пула — БЕЗ НЕГО ПРОЦЕСС ПАДАЕТ.
 *
 * node-postgres эмитит событие 'error' на пуле, когда обрывается соединение,
 * которое лежит в пуле без дела: рестарт PostgreSQL (ночной бэкап, обновление
 * Windows), обрыв сети, `pg_terminate_backend` от DBA, отсечение простоя
 * фаерволом. Пул — это EventEmitter, а необработанное событие 'error' в Node
 * не логируется, а ВЫБРАСЫВАЕТСЯ: весь API-процесс умирает целиком, вместе с
 * заказами на планшетах у нарезчика.
 *
 * С этим слушателем пул просто выбрасывает битого клиента и открывает новое
 * соединение на следующем запросе — процесс живёт, кухня не замечает рестарта БД.
 *
 * Логируем ошибку и НЕ гасим процесс: если проблема системная (БД не поднялась),
 * это увидит служба-супервизор по логам, а живой API продолжит отвечать 500 на
 * запросы вместо того чтобы исчезнуть с порта.
 */
pool.on('error', (err) => {
  console.error('[DB] Ошибка простаивающего соединения пула (соединение будет пересоздано):', err);
});

/** Проверка подключения к БД при старте */
export async function testConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    // Заодно печатаем реальную зону сессии — при разборе «время уехало на 5 часов»
    // это первое, что нужно увидеть в логе старта
    const result = await client.query('SELECT NOW() as now, current_setting($1) as tz', ['TimeZone']);
    console.log(`[DB] Подключено к PostgreSQL: ${result.rows[0].now} (часовой пояс сессии: ${result.rows[0].tz})`);
    client.release();
  } catch (err) {
    console.error('[DB] Ошибка подключения к PostgreSQL:', err);
    throw err;
  }
}
