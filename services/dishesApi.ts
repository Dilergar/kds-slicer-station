/**
 * API-клиент для получения блюд из ctlg15_dishes.
 */
import { apiFetch } from './client';
import { Dish } from '../types';

/** Получить все блюда */
export const fetchDishes = (): Promise<Dish[]> =>
  apiFetch('/dishes');

/**
 * Назначить блюду список slicer-категорий (полная замена).
 * Используется при сохранении рецепта в RecipeEditor.
 */
export const updateDishCategories = (
  dishId: string,
  categoryIds: string[]
): Promise<{ updated: boolean }> =>
  apiFetch(`/dishes/${dishId}/categories`, {
    method: 'PUT',
    body: JSON.stringify({ category_ids: categoryIds }),
  });

/**
 * Назначить блюду приоритет отображения (NORMAL=1 или ULTRA=3).
 * Записывается в slicer_dish_priority (UPSERT). Используется в RecipeEditor
 * при сохранении рецепта вместе с категориями.
 */
export const updateDishPriority = (
  dishId: string,
  priorityFlag: number
): Promise<{ updated: boolean }> =>
  apiFetch(`/dishes/${dishId}/priority`, {
    method: 'PUT',
    body: JSON.stringify({ priority_flag: priorityFlag }),
  });

/**
 * Сбросить slicer-настройки блюда — чистит рецепт, назначения категорий и алиасы.
 * Само блюдо остаётся в ctlg15_dishes (чужая таблица) и после сброса снова
 * появится в секции «Без категории» в RecipeEditor.
 */
export const clearDishSlicerData = (
  dishId: string
): Promise<{
  cleared: boolean;
  deleted: { recipes: number; categories: number; aliases: number };
}> =>
  apiFetch(`/dishes/${dishId}/slicer-data`, { method: 'DELETE' });

/**
 * Назначить блюду флаг «требует разморозки?» и per-dish время разморозки
 * в минутах (миграции 016, 020). В RecipeEditor перед вызовом dishId
 * резолвится в primary через aliasMap — запись живёт на primary-блюде,
 * алиасы наследуют через recipe_source_id.
 * Минуты: целое 1..60, по умолчанию 15 если не указано (бэк примет и это,
 * когда юзер выключил флаг и значение неважно).
 */
export const updateDishDefrost = (
  dishId: string,
  requiresDefrost: boolean,
  defrostDurationMinutes?: number
): Promise<{ updated: boolean }> =>
  apiFetch(`/dishes/${dishId}/defrost`, {
    method: 'PUT',
    body: JSON.stringify({
      requires_defrost: requiresDefrost,
      defrost_duration_minutes: defrostDurationMinutes
    })
  });
