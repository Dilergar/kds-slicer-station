/**
 * services/authApi.ts — Клиент для авторизации по PIN.
 *
 * Один метод: login(pin) → AuthUser. Backend ходит в чужую таблицу `users`
 * и возвращает список ролей (имена) — фронт сам решает что разрешить.
 */

import { AuthUser } from '../types';
import { apiFetch } from './client';

/**
 * Проверить PIN на backend. 4-значный integer. При успехе — данные юзера.
 * При неверном PIN backend возвращает 401 → apiFetch бросит Error('Invalid PIN').
 */
export async function loginByPin(pin: number): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pin })
  });
}

/**
 * Перепроверить сохранённую сессию: жив ли ещё пользователь и не изменились
 * ли его роли. Бросает при 401 (уволен/заблокирован) — вызывающий разлогинивает.
 * @param uuid — идентификатор пользователя из сохранённой сессии
 * @returns актуальные данные пользователя
 */
export async function revalidateSession(uuid: string): Promise<AuthUser> {
  return apiFetch<AuthUser>(`/auth/me?uuid=${encodeURIComponent(uuid)}`);
}
