/**
 * API-клиент для рецептов (slicer_recipes).
 */
import { apiFetch } from './client';

/** Получить ингредиенты рецепта блюда */
export const fetchRecipe = (dishId: string): Promise<{
  id: string;
  quantity: number;
  name: string;
  unitType: string;
  pieceWeightGrams?: number;
  imageUrl?: string;
}[]> =>
  apiFetch(`/recipes/${dishId}`);

/** Установить/заменить рецепт блюда */
export const updateRecipe = (dishId: string, ingredients: {
  ingredientId: string;
  quantity: number;
}[]): Promise<{ updated: boolean }> =>
  apiFetch(`/recipes/${dishId}`, { method: 'PUT', body: JSON.stringify({ ingredients }) });
