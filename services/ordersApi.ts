/**
 * API-клиент для работы с заказами.
 * Заказы читаются из docm2_orders + slicer_order_state через backend.
 */
import { apiFetch } from './client';
import { Order, OrderHistoryEntry } from '../types';

/** Получить активные заказы (polling каждые 4 сек) */
export const fetchOrders = (): Promise<Order[]> =>
  apiFetch('/orders');

/**
 * Завершить заказ.
 *
 * actorUuid/actorName (миграция 029) — кто нажал «Готово», из PIN-сессии.
 * Уходит в slicer_order_history.completed_by_* и попадает в отчёт «Скорость
 * нарезчика» (имя порции + фильтр по нарезчикам).
 */
export const completeOrder = (id: string, data: {
  dishId: string;
  dishName: string;
  totalQuantity: number;
  prepTimeMs: number;
  wasParked?: boolean;
  snapshot: Order;
  consumedIngredients: any[];
  actorUuid?: string;
  actorName?: string;
}): Promise<{ completed: boolean; historyId: string }> =>
  apiFetch(`/orders/${id}/complete`, { method: 'POST', body: JSON.stringify(data) });

/**
 * Частичное завершение заказа.
 *
 * Остаток НЕ передаётся: сервер считает его сам от актуального состояния в БД
 * под блокировкой строки и отвечает 409, если запрошено больше, чем осталось.
 * Раньше остаток присылал клиент, и два планшета с устаревшей доской могли
 * суммарно отдать больше, чем есть в заказе.
 */
export const partialCompleteOrder = (id: string, data: {
  dishId: string;
  dishName: string;
  quantityToComplete: number;
  prepTimeMs: number;
  wasParked?: boolean;
  snapshot: Order;
  consumedIngredients: any[];
  actorUuid?: string;
  actorName?: string;
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

/**
 * Подтвердить объединение виртуальной карточки Smart Wave (миграция 022).
 * Всем переданным реальным source-заказам проставляется merge_ack=TRUE в
 * slicer_order_state — подтверждение переживает F5 и синхронно между
 * планшетами. Новые source-ы того же блюда приходят с merge_ack=FALSE и
 * рисуются отдельным блоком до следующего Merge.
 */
export const mergeAckOrders = (
  orderItemIds: string[]
): Promise<{ acked: boolean; items: number }> =>
  apiFetch('/orders/merge-ack', {
    method: 'POST',
    body: JSON.stringify({ orderItemIds })
  });

// ======================================================================
// Клейм «В работе» — режим 2–3 нарезчиков (миграция 029)
// ======================================================================

/**
 * Взять карточку в работу.
 *
 * orderItemIds — ВСЕ реальные позиции карточки (в агрегированных режимах их
 * несколько). Карточка атомарна: если хоть одна позиция занята другим
 * нарезчиком, сервер отвечает 409 и никого не перетирает — клейм не
 * «расщепляется» между двумя людьми.
 *
 * @returns `{claimed: true}` при успехе. При 409 apiFetch бросает ошибку с
 *          текстом сервера — вызывающий код откатывает оптимистичную метку.
 */
export const claimOrders = (
  orderItemIds: string[],
  actor: { uuid: string; name: string }
): Promise<{ claimed: boolean; items: number }> =>
  apiFetch('/orders/claim', {
    method: 'POST',
    body: JSON.stringify({ orderItemIds, actorUuid: actor.uuid, actorName: actor.name })
  });

/**
 * Отпустить карточку (повторный тап по своей).
 * Снимается только СВОЙ клейм — чужой сервер не тронет.
 */
export const unclaimOrders = (
  orderItemIds: string[],
  actorUuid: string
): Promise<{ released: number }> =>
  apiFetch('/orders/unclaim', {
    method: 'POST',
    body: JSON.stringify({ orderItemIds, actorUuid })
  });

/**
 * Получить историю заказов.
 *
 * Всегда передавайте либо период (from/to), либо retentionMinutes — сервер без
 * них отдаст только жёстко ограниченный «хвост». Раньше вызов без параметров
 * тянул всю накопленную историю целиком, вместе с JSON-снимками заказов.
 *
 * @param opts.from / opts.to — явный период в ISO (используется отчётами)
 * @param opts.retentionMinutes — окно «последние N минут» (используется доской)
 */
export const fetchOrderHistory = (
  opts?: { from?: string; to?: string; retentionMinutes?: number }
): Promise<OrderHistoryEntry[]> => {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  if (opts?.retentionMinutes != null) params.set('retentionMinutes', String(opts.retentionMinutes));
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
