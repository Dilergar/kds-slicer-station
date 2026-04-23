/**
 * useAuth.ts — Авторизация модуля по PIN (из чужой таблицы `users`).
 *
 * - login(pin) → POST /api/auth/login → сохраняем AuthUser в state + localStorage.
 * - logout() → очищаем state + localStorage.
 * - user подхватывается из localStorage при монтировании — F5 не выкидывает.
 *
 * Автовыход намеренно не реализован: заказчик попросил «один раз залогинился —
 * до ручного Выйти» (см. историю чата). Если появится требование — добавить
 * таймер бездействия на activity listeners здесь.
 */

import { useState, useEffect, useCallback } from 'react';
import { AuthUser } from '../types';
import { loginByPin } from '../services/authApi';

const STORAGE_KEY = 'slicer_auth_user';

/**
 * Безопасно прочитать сохранённого юзера из localStorage.
 * Если там мусор (чужое приложение писало, ручная правка) — возвращаем null
 * и чистим ключ, чтобы не застрять в битом состоянии.
 */
function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.uuid === 'string' &&
      typeof parsed.login === 'string' &&
      Array.isArray(parsed.roles)
    ) {
      return parsed as AuthUser;
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());

  // Синхронизация между вкладками: если в другой вкладке нажали «Выйти» —
  // эта вкладка тоже разлогинивается. Не критично для планшета, но дёшево.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setUser(loadStoredUser());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (pin: number) => {
    const u = await loginByPin(pin);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return { user, login, logout };
}
