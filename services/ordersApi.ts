/**
 * API-клиент для работы с заказами.
 * Заказы читаются из docm2_orders + slicer_order_state через backend.
 */
import { apiFetch } from './client';
import { Order, OrderHistoryEntry } from '../types';

/** Получить активные заказы (polling каждые 4 сек) */
export const fetchOrders = (): Promise<Order[]> =>
  apiFetch('/orders');

/** Завершить заказ */
export const completeOrder = (id: string, data: {
  dishId: string;
  dishName: string;
  totalQuantity: number;
  prepTimeMs: number;
  wasParked?: boolean;
  snapshot: Order;
  consumedIngredients: any[];
}): Promise<{ completed: boolean; historyId: string }> =>
  apiFetch(`/orders/${id}/complete`, { method: 'POST', body: JSON.stringify(data) });

/** Частичное завершение заказа */
export const partialCompleteOrder = (id: string, data: {
  dishId: string;
  dishName: string;
  quantityToComplete: number;
  prepTimeMs: number;
  wasParked?: boolean;
  snapshot: Order;
  consumedIngredients: any[];
  remainingQuantityStack: number[];
  remainingTableStack: number[][];
}): Promise<{ completed: boolean; historyId: string }> =>
  apiFetch(`/orders/${id}/partial-complete`, { method: 'POST', body: JSON.stringify(data) });

/** Отменить заказ */
export const cancelOrder = (id: string): Promise<{ cancelled: boolean }> =>
  apiFetch(`/orders/${id}/cancel`, { method: 'POST' });

/** Парковка стола */
export const parkOrder = (id: string, data: {
  quantityStack: number[];
  tableStack: number[][];
  parkedTables: number[];
  unparkAt: number | null;
  accumulatedTimeMs: number;
}): Promise<{ parked: boolean }> =>
  apiFetch(`/orders/${id}/park`, { method: 'POST', body: JSON.stringify(data) });

/** Снять с парковки */
export const unparkOrder = (id: string): Promise<{ unparked: boolean }> =>
  apiFetch(`/orders/${id}/unpark`, { method: 'POST' });

/** Объединить стеки */
export const mergeOrder = (id: string, data: {
  quantityStack: number[];
  tableStack: number[][];
}): Promise<{ merged: boolean }> =>
  apiFetch(`/orders/${id}/merge`, { method: 'POST', body: JSON.stringify(data) });

/** Получить историю заказов */
export const fetchOrderHistory = (from?: string, to?: string): Promise<OrderHistoryEntry[]> => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiFetch(`/history/orders${qs ? `?${qs}` : ''}`);
};

/** Удалить запись из истории (для restore) */
export const deleteOrderHistory = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/history/orders/${id}`, { method: 'DELETE' });

/**
 * Восстановить позицию в активные (UPSERT slicer_order_state = ACTIVE).
 * quantityStack/tableStack — финальные значения, которые должны оказаться
 * на доске после восстановления. Считаются на фронте: snapshot + текущий
 * остаток от partial-complete (если есть).
 */
export const restoreOrder = (id: string, data: {
  quantityStack: number[];
  tableStack: number[][];
}): Promise<{ restored: boolean }> =>
  apiFetch(`/orders/${id}/restore`, { method: 'POST', body: JSON.stringify(data) });

// ======================================================================
// Разморозка (миграция 016)
// ======================================================================

/**
 * Запустить таймер разморозки для позиции.
 * sourceOrderItemIds нужен для Smart Wave: виртуальный заказ мапится на
 * несколько реальных order_item_id, все апдейтятся атомарно.
 */
export const startDefrost = (
  id: string,
  sourceOrderItemIds?: string[]
): Promise<{ started: boolean; durationSeconds: number; items: number }> =>
  apiFetch(`/orders/${id}/defrost-start`, {
    method: 'POST',
    body: JSON.stringify({ sourceOrderItemIds })
  });

/** Отменить разморозку (вернуть карточку в очередь с восстановленным ULTRA). */
export const cancelDefrost = (
  id: string,
  sourceOrderItemIds?: string[]
): Promise<{ cancelled: boolean; items: number }> =>
  apiFetch(`/orders/${id}/defrost-cancel`, {
    method: 'POST',
    body: JSON.stringify({ sourceOrderItemIds })
  });

/**
 * Вручную подтвердить готовность («Разморозилась»).
 * Бэкенд сдвигает defrost_started_at в прошлое → таймер истёкший, карточка
 * возвращается в очередь. ULTRA-статус сохраняется — сортировка по приоритету
 * блюда, а не по истории разморозки. started_at остаётся NOT NULL только как
 * индикатор «проходило разморозку» (серая ❄️ на карточке + защита от
 * повторного запуска таймера).
 */
export const completeDefrost = (
  id: string,
  sourceOrderItemIds?: string[]
): Promise<{ completed: boolean; items: number }> =>
  apiFetch(`/orders/${id}/defrost-complete`, {
    method: 'POST',
    body: JSON.stringify({ sourceOrderItemIds })
  });
