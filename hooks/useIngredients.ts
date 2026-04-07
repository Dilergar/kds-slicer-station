import { useState, useMemo } from 'react';
import { IngredientBase } from '../types';

/**
 * Хук для управления справочником Ингредиентов.
 * 
 * ВАЖНО ДЛЯ БУДУЩЕЙ РЕАЛИЗАЦИИ БД (PostgreSQL):
 * - Замените useState и методы ниже на асинхронные запросы (`fetch`, `axios` или подобные).
 * - ingMap полезно держать на клиенте для быстрого доступа, 
 *   хотя джойны (JOIN) в базе в некоторых местах заменят его необходимость.
 * 
 * @param initialIngredients Начальный массив ингредиентов (заменится на пустой массив при переходе на БД).
 */
export const useIngredients = (initialIngredients: IngredientBase[]) => {
  const [ingredients, setIngredients] = useState<IngredientBase[]>(initialIngredients);

  /**
   * Оптимизация поиска (O(1) lookup). 
   * Позволяет мгновенно найти сырьё по ID, избегая O(N) поиска в массивах.
   */
  const ingMap = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);

  /**
   * Добавляет новый ингредиент в базу.
   * [БД Миграция]: INSERT INTO ingredients (...)
   * 
   * @param name Название ингредиента
   * @param parentId ID родительской категории (если есть)
   * @param unitType Единица измерения (кг или штуки)
   * @param pieceWeightGrams Средний вес 1 штуки (если unitType === 'piece')
   */
  const handleAddIngredient = (name: string, parentId?: string, unitType: 'kg' | 'piece' = 'kg', pieceWeightGrams?: number) => {
    const newIng: IngredientBase = {
      id: `ing_${Date.now()}`,
      name,
      parentId,
      unitType,
      pieceWeightGrams,
      is_stopped: false
    };
    setIngredients(prev => [...prev, newIng]);
  };

  /**
   * Обновляет поля существующего ингредиента.
   * [БД Миграция]: UPDATE ingredients SET ... WHERE id = :id
   * 
   * @param id ID ингредиента для обновления
   * @param updates Частичный объект обновления (Partial<IngredientBase>)
   */
  const handleUpdateIngredient = (id: string, updates: Partial<IngredientBase>) => {
    setIngredients(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  };

  /**
   * Удаляет ингредиент и каскадно всё, что в него вложено.
   * [БД Миграция]: DELETE FROM ingredients WHERE id = :id OR parentId = :id
   * (Либо настроить Foreign Key с ON DELETE CASCADE в PostgreSQL)
   * 
   * @param id ID ингредиента для удаления
   */
  const handleDeleteIngredient = (id: string) => {
    setIngredients(prev => prev.filter(i => i.id !== id && i.parentId !== id));
  };

  return {
    ingredients,
    setIngredients,
    ingMap,
    handleAddIngredient,
    handleUpdateIngredient,
    handleDeleteIngredient
  };
};
