/**
 * API-клиент для работы с категориями (slicer_categories).
 */
import { apiFetch } from './client';
import { Category } from '../types';

/** Получить все категории */
export const fetchCategories = (): Promise<Category[]> =>
  apiFetch('/categories');

/** Создать категорию */
export const createCategory = (name: string): Promise<Category> =>
  apiFetch('/categories', { method: 'POST', body: JSON.stringify({ name }) });

/** Обновить категорию */
export const updateCategory = (id: string, data: Partial<Category>): Promise<Category> =>
  apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });

/** Удалить категорию */
export const deleteCategory = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/categories/${id}`, { method: 'DELETE' });

/** Пакетное обновление порядка */
export const reorderCategories = (order: { id: string; sort_index: number }[]): Promise<{ reordered: boolean }> =>
  apiFetch('/categories/reorder', { method: 'PUT', body: JSON.stringify({ order }) });
