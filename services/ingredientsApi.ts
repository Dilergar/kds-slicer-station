/**
 * API-клиент для работы с ингредиентами (slicer_ingredients).
 */
import { apiFetch } from './client';
import { IngredientBase } from '../types';

/** Получить все ингредиенты */
export const fetchIngredients = (): Promise<IngredientBase[]> =>
  apiFetch('/ingredients');

/** Создать ингредиент */
export const createIngredient = (data: {
  name: string;
  parentId?: string;
  unitType?: 'kg' | 'piece';
  pieceWeightGrams?: number;
  imageUrl?: string;
}): Promise<IngredientBase> =>
  apiFetch('/ingredients', { method: 'POST', body: JSON.stringify(data) });

/** Обновить ингредиент */
export const updateIngredient = (id: string, data: Partial<IngredientBase>): Promise<IngredientBase> =>
  apiFetch(`/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(data) });

/**
 * Переименовать сырьё вместе с приставками во всех его разновидностях —
 * одной транзакцией на сервере. Раньше клиент слал по отдельному запросу на
 * родителя и на каждого ребёнка, и обрыв связи посреди цикла оставлял половину
 * разновидностей со старой приставкой.
 * @param id — id сырья (родителя)
 * @param name — новое название
 */
export const renameParentIngredient = (id: string, name: string): Promise<{ renamed: boolean; children: number }> =>
  apiFetch(`/ingredients/${id}/rename-parent`, { method: 'PUT', body: JSON.stringify({ name }) });

/** Сколько всего заденет удаление ингредиента (для диалога подтверждения) */
export const fetchIngredientUsage = (id: string): Promise<{ children: number; recipes: number; activeStops: number }> =>
  apiFetch(`/ingredients/${id}/usage`);

/** Удалить ингредиент */
export const deleteIngredient = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/ingredients/${id}`, { method: 'DELETE' });
