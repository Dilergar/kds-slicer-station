/**
 * API-клиент для работы с алиасами блюд (slicer_dish_aliases).
 *
 * Используется в RecipeEditor для управления связями "блюдо-алиас → блюдо-primary".
 * Нужно только для UI управления — сами алиасы резолвятся на backend в /api/orders
 * и /api/dishes, фронт не участвует в этой логике.
 */
import { apiFetch } from './client';

export interface DishAlias {
  alias_dish_id: string;
  primary_dish_id: string;
  created_at?: string;
}

/** Получить все алиасы (map: alias → primary) */
export const fetchDishAliases = (): Promise<DishAlias[]> =>
  apiFetch('/dish-aliases');

/** Создать или обновить алиас: связать blud-alias с blud-primary */
export const linkDishToAlias = (aliasDishId: string, primaryDishId: string): Promise<DishAlias> =>
  apiFetch('/dish-aliases', {
    method: 'POST',
    body: JSON.stringify({ alias_dish_id: aliasDishId, primary_dish_id: primaryDishId })
  });

/** Удалить алиас: блюдо снова становится independent */
export const unlinkDishAlias = (aliasDishId: string): Promise<{ unlinked: boolean }> =>
  apiFetch(`/dish-aliases/${aliasDishId}`, { method: 'DELETE' });
