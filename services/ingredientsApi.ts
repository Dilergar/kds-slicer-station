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

/** Удалить ингредиент */
export const deleteIngredient = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/ingredients/${id}`, { method: 'DELETE' });
