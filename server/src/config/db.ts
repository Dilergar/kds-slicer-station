/**
 * Конфигурация подключения к PostgreSQL (база arclient).
 * Используется пул соединений для эффективной работы с множественными запросами.
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/** Пул соединений к БД arclient */
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'arclient',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  max: 20,               // Максимум соединений в пуле
  idleTimeoutMillis: 30000,  // Закрывать неактивные через 30 сек
  connectionTimeoutMillis: 2000  // Таймаут подключения 2 сек
});

/** Проверка подключения к БД при старте */
export async function testConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now');
    console.log(`[DB] Подключено к PostgreSQL: ${result.rows[0].now}`);
    client.release();
  } catch (err) {
    console.error('[DB] Ошибка подключения к PostgreSQL:', err);
    throw err;
  }
}
