/**
 * Базовый HTTP-клиент для API запросов.
 * Все запросы проксируются через Vite: /api → localhost:3001.
 */

const BASE_URL = '/api';

/**
 * Обёртка над fetch с обработкой ошибок и автоматическим JSON-парсингом.
 * @param path — путь API (например, '/ingredients')
 * @param options — параметры fetch (method, body и т.д.)
 * @returns Распарсенный JSON-ответ
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
