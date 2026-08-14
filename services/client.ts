/**
 * Базовый HTTP-клиент для API запросов.
 * Все запросы проксируются через Vite: /api → localhost:3001.
 */

const BASE_URL = '/api';

/**
 * Предел ожидания ответа по умолчанию, мс.
 *
 * Зачем нужен: планшет на границе покрытия Wi-Fi даёт не «обрыв», а «зависание» —
 * TCP-соединение открыто, ответа нет. Без предела такой запрос живёт минутами,
 * держит флаг «идёт опрос» в useOrders (опрос заказов не возобновляется) и
 * занимает один из ~6 слотов соединений браузера. Несколько зависших запросов —
 * и POST-действия нарезчика («Готово», парковка) встают в очередь и не уходят.
 */
export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Возвращает AbortSignal, который сработает через заданное время.
 * Выделено отдельно, потому что AbortSignal.timeout есть не везде —
 * на старом WebView планшета падать из-за этого нельзя.
 * @param ms — сколько ждать до отмены
 * @returns сигнал отмены либо undefined, если браузер не поддерживает отмену
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  }
  return undefined;
}

/** Параметры apiFetch: обычные опции fetch + необязательный свой предел ожидания */
export interface ApiFetchOptions extends RequestInit {
  /** Предел ожидания в мс; по умолчанию DEFAULT_TIMEOUT_MS. Передайте 0 чтобы отключить. */
  timeoutMs?: number;
}

/**
 * Обёртка над fetch с обработкой ошибок, пределом ожидания и автоматическим JSON-парсингом.
 * @param path — путь API (например, '/ingredients')
 * @param options — параметры fetch (method, body, timeoutMs и т.д.)
 * @returns Распарсенный JSON-ответ
 */
export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options ?? {};

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    // Свой сигнал вызывающего имеет приоритет: если он передан, предел не навязываем
    signal: signal ?? (timeoutMs > 0 ? timeoutSignal(timeoutMs) : undefined),
    ...rest,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
