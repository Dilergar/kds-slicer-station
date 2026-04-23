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
      return res.status(401).json({ error: 'Invalid PIN' });
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

export default router;
