/**
 * routes/auth.ts — Авторизация пользователей модуля нарезчика по PIN-коду.
 *
 * Источник истины — ЧУЖАЯ таблица `users` (рабочая БД заказчика). Читаем
 * только, ничего туда не пишем — как и все остальные не-`slicer_*` таблицы.
 * Связь user ↔ роль идёт через `userroles` (many-to-many) → `roles.name`.
 * Фронт на основании ролей решает какие вкладки показывать.
 *
 * Валидация PIN:
 *   - Должен быть ровно 4 цифры (в БД тип integer, но -1 = «выключенный PIN»).
 *   - `users.locked = false` обязательно.
 *   - `users.pin > 0` — отсекаем -1 и пустые значения.
 *
 * Без сессий/JWT намеренно: модуль — локальный планшет на кухне, токен хранит
 * фронт в localStorage, backend stateless (доверяем фронту, как и было
 * раньше). Если появится реальная угроза — добавим bcrypt+JWT поверх, эта
 * схема расширяема.
 */

import { Router } from 'express';
import { pool } from '../config/db';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Ограничение попыток входа
//
// PIN — всего 4 цифры, то есть 9000 вариантов. Без ограничения любой, кто попал
// в Wi-Fi ресторана, перебирает их за минуты и получает действующие PIN
// сотрудников заказчика вместе с логинами и ролями. Это не только доступ к
// нашему модулю: PIN лежит в рабочей таблице `users` и используется их основной
// системой. Счётчик в памяти процесса — этого достаточно для «локальной сети
// кухни», внешнего хранилища ради этого не заводим.
// ─────────────────────────────────────────────────────────────────────────────

/** Окно подсчёта попыток, мс */
const RATE_WINDOW_MS = 60_000;
/** Сколько неудачных попыток допускается в окне с одного адреса */
const RATE_MAX_FAILURES = 10;
/** Задержка ответа при неудаче, мс — гасит скорость перебора даже внутри лимита */
const FAILURE_DELAY_MS = 400;

/** Состояние счётчика по одному адресу */
interface RateEntry {
  failures: number;
  /** Момент начала текущего окна */
  windowStart: number;
}

const loginAttempts = new Map<string, RateEntry>();

/**
 * Проверяет, не исчерпан ли лимит попыток для адреса, и заодно чистит
 * протухшие записи, чтобы Map не рос бесконечно.
 * @param ip — адрес клиента
 * @returns true, если попытку нужно отклонить
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();

  // Ленивая уборка: окна старше двух периодов уже не нужны
  for (const [key, entry] of loginAttempts) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) loginAttempts.delete(key);
  }

  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.failures >= RATE_MAX_FAILURES;
}

/**
 * Отмечает неудачную попытку входа с адреса.
 * @param ip — адрес клиента
 */
function registerFailure(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    loginAttempts.set(ip, { failures: 1, windowStart: now });
    return;
  }
  entry.failures += 1;
}

/** Пауза, чтобы неудачный ответ не возвращался мгновенно @param ms — сколько ждать */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * POST /api/auth/login — проверить PIN и вернуть данные пользователя.
 *
 * Body: { pin: number }
 * Response 200: { uuid, login, roles: string[] }  — массив имён ролей
 * Response 400: { error: 'Invalid PIN format' }   — pin не число / не 4 цифры
 * Response 401: { error: 'Invalid PIN' }           — не найден / locked / pin=-1
 *
 * Роли возвращаем массивом имён (не uuid) — фронту удобнее матчить по строке
 * ('Официант', 'Заведующий производством', ...). У одного юзера может быть
 * несколько ролей — возвращаем все, объединение прав на фронте.
 */
router.post('/login', async (req, res) => {
  const { pin } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    console.warn(`[auth] Превышен лимит попыток входа с ${ip}`);
    return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
  }

  // Формальная валидация: должен быть положительный 4-значный integer
  if (typeof pin !== 'number' || !Number.isInteger(pin) || pin < 1000 || pin > 9999) {
    return res.status(400).json({ error: 'Invalid PIN format' });
  }

  try {
    // Один запрос с LEFT JOIN — юзер с ролями, или юзер без ролей (тогда roles=[null])
    const result = await pool.query<{ uuid: string; login: string; role: string | null }>(
      `SELECT u.uuid, u.login, r.name AS role
       FROM users u
       LEFT JOIN userroles ur ON ur.user_uuid = u.uuid
       LEFT JOIN roles r ON r.uuid = ur.role_uuid
       WHERE u.pin = $1
         AND u.locked = false
         AND u.pin > 0`,
      [pin]
    );

    if (result.rows.length === 0) {
      registerFailure(ip);
      await delay(FAILURE_DELAY_MS);
      return res.status(401).json({ error: 'Неверный PIN' });
    }

    // Все строки относятся к одному юзеру (фильтр по pin), группируем роли
    const first = result.rows[0];
    const roles = result.rows
      .map(r => r.role)
      .filter((r): r is string => r !== null);

    res.json({
      uuid: first.uuid,
      login: first.login.trim(),
      roles
    });
  } catch (err) {
    console.error('[auth] Ошибка проверки PIN:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me?uuid=… — перепроверка сохранённой сессии.
 *
 * Зачем: сессия лежит в localStorage без срока годности и до сих пор никогда
 * не проверялась. Уволенного и заблокированного сотрудника планшет, открытый
 * неделю, продолжал пускать в админку и отчёты и подписывал его именем записи
 * стоп-листа. Обратное тоже: расширили роль — новые вкладки не появлялись до
 * ручного перезахода.
 *
 * Возвращает актуальные login и roles (роли могли измениться) либо 401, если
 * пользователь пропал или заблокирован. PIN здесь не участвует — идентификатор
 * сессии уже выдан при входе, и передавать PIN повторно незачем.
 *
 * Response 200: { uuid, login, roles: string[] }
 * Response 400: { error } — uuid не передан или не похож на uuid
 * Response 401: { error } — пользователь не найден либо заблокирован
 */
router.get('/me', async (req, res) => {
  const uuid = typeof req.query.uuid === 'string' ? req.query.uuid : '';

  // Проверяем формат до запроса: колонка users.uuid имеет тип uuid,
  // и мусор в параметре дал бы 22P02 и бессмысленный 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return res.status(400).json({ error: 'Некорректный uuid' });
  }

  try {
    const result = await pool.query<{ uuid: string; login: string; role: string | null }>(
      `SELECT u.uuid, u.login, r.name AS role
       FROM users u
       LEFT JOIN userroles ur ON ur.user_uuid = u.uuid
       LEFT JOIN roles r ON r.uuid = ur.role_uuid
       WHERE u.uuid = $1
         AND u.locked = false
         AND u.pin > 0`,
      [uuid]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Сессия недействительна' });
    }

    const first = result.rows[0];
    const roles = result.rows
      .map(r => r.role)
      .filter((r): r is string => r !== null);

    res.json({ uuid: first.uuid, login: first.login.trim(), roles });
  } catch (err) {
    console.error('[auth] Ошибка перепроверки сессии:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
