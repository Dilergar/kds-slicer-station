/**
 * API-клиент для получения метрики «Скорость готовки повара».
 *
 * Метрика считается как разница между моментом когда нарезчик нажал «Готово»
 * (slicer_order_state.finished_at) и моментом когда основная KDS отметила
 * блюдо приготовленным (docm2tabl1_items.docm2tabl1_cooktime).
 *
 * Endpoint: GET /api/history/dashboard/chef-cooking-speed?from=...&to=...
 */

import { apiFetch } from './client';
import { ChefCookingEntry } from '../types';

/**
 * Загружает сырые записи метрики за период.
 * @param from ISO-дата начала (включительно)
 * @param to ISO-дата конца (включительно)
 */
export function fetchChefCookingEntries(from: string, to: string): Promise<ChefCookingEntry[]> {
  const params = new URLSearchParams({ from, to });
  return apiFetch<ChefCookingEntry[]>(`/history/dashboard/chef-cooking-speed?${params.toString()}`);
}
