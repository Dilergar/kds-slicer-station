/**
 * API-клиент для стоп-листа (slicer_ingredients + slicer_stop_history).
 */
import { apiFetch } from './client';
import { StopHistoryEntry } from '../types';

/** Переключить стоп-лист ингредиента или блюда */
export const toggleStop = (data: {
  targetId: string;
  targetType: 'ingredient' | 'dish';
  reason?: string;
  // Дополнительные поля для dish:
  stoppedAt?: number;
  stopReason?: string;
  dishName?: string;
  isStopping?: boolean;
  // Актор действия (миграция 014) — залогиненный юзер из useAuth.
  // Если не передано — backend запишет NULL (обратная совместимость).
  actorUuid?: string | null;
  actorName?: string | null;
}): Promise<{ toggled: boolean; is_stopped?: boolean }> =>
  apiFetch('/stoplist/toggle', { method: 'POST', body: JSON.stringify(data) });

/** Получить историю стопов */
export const fetchStopHistory = (from?: string, to?: string): Promise<StopHistoryEntry[]> => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiFetch(`/stoplist/history${qs ? `?${qs}` : ''}`);
};
