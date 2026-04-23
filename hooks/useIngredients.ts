import { useState, useMemo, useEffect, useCallback } from 'react';
import { IngredientBase } from '../types';
import { fetchIngredients, createIngredient, updateIngredient, deleteIngredient } from '../services/ingredientsApi';

/**
 * Хук для управления справочником Ингредиентов.
 * Загружает данные из PostgreSQL через API.
 * ingMap — O(1) lookup для быстрого поиска по ID.
 */
export const useIngredients = () => {
  const [ingredients, setIngredients] = useState<IngredientBase[]>([]);
  const [loading, setLoading] = useState(true);

  /** Оптимизация поиска (O(1) lookup по ID) */
  const ingMap = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);

  /** Загрузка ингредиентов из БД при монтировании */
  const loadIngredients = useCallback(async () => {
    try {
      const data = await fetchIngredients();
      setIngredients(data);
    } catch (err) {
      console.error('[useIngredients] Ошибка загрузки:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIngredients();
  }, [loadIngredients]);

  /**
   * Добавляет новый ингредиент через API.
   * После создания — перезагружает список.
   */
  const handleAddIngredient = useCallback(async (name: string, parentId?: string, unitType: 'kg' | 'piece' = 'kg', pieceWeightGrams?: number) => {
    try {
      await createIngredient({ name, parentId, unitType, pieceWeightGrams });
      await loadIngredients();
    } catch (err) {
      console.error('[useIngredients] Ошибка создания:', err);
    }
  }, [loadIngredients]);

  /**
   * Обновляет поля существующего ингредиента через API.
   */
  const handleUpdateIngredient = useCallback(async (id: string, updates: Partial<IngredientBase>) => {
    try {
      await updateIngredient(id, updates);
      await loadIngredients();
    } catch (err) {
      console.error('[useIngredients] Ошибка обновления:', err);
    }
  }, [loadIngredients]);

  /**
   * Удаляет ингредиент через API (каскадно удаляет children через FK).
   */
  const handleDeleteIngredient = useCallback(async (id: string) => {
    try {
      await deleteIngredient(id);
      await loadIngredients();
    } catch (err) {
      console.error('[useIngredients] Ошибка удаления:', err);
    }
  }, [loadIngredients]);

  return {
    ingredients,
    setIngredients,
    ingMap,
    loading,
    handleAddIngredient,
    handleUpdateIngredient,
    handleDeleteIngredient,
    reloadIngredients: loadIngredients
  };
};
