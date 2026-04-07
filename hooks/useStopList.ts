import React, { useState, useEffect } from 'react';
import { IngredientBase, Dish, StopHistoryEntry } from '../types';
import { generateId } from '../utils';

interface UseStopListProps {
  ingredients: IngredientBase[];
  setIngredients: React.Dispatch<React.SetStateAction<IngredientBase[]>>;
  ingMap: Map<string, IngredientBase>;
  dishes: Dish[];
  setDishes: React.Dispatch<React.SetStateAction<Dish[]>>;
  dishMap: Map<string, Dish>;
  initialHistory?: StopHistoryEntry[];
}

/**
 * Хук для управления Стоп-Листами продуктов и блюд.
 * 
 * ВАЖНО ДЛЯ БУДУЩЕЙ РЕАЛИЗАЦИИ БД (PostgreSQL):
 * - `stopHistory` таблицу (логирование длительности стопов) следует генерировать на бекенде, 
 *   слушая изменения флага `is_stopped` через Postgres Triggers / Webhooks. 
 * - Каскадное отключение БД (ингредиент стоп -> блюдо стоп) должно быть 
 *   вынесено на сторону БД в виде материализованного представления или триггера, 
 *   чтобы фронтенд не гонял лишние данные. В этом случае useEffect отсюда можно удалить.
 */
export const useStopList = ({
  ingredients,
  setIngredients,
  ingMap,
  dishes,
  setDishes,
  dishMap,
  initialHistory = []
}: UseStopListProps) => {
  const [stopHistory, setStopHistory] = useState<StopHistoryEntry[]>(initialHistory);

  /**
   * Ставит ингредиент (сырьё) в стоп-лист или снимает с него.
   * Вычисляет продолжительность и записывает это в архив истории стопов.
   * [БД Миграция]: UPDATE ingredients SET is_stopped = true, stop_reason = :reason, stop_timestamp = now() WHERE id = :id
   * 
   * @param ingredientId Идентификатор сырья
   * @param reason Опциональная причина стопа
   */
  const handleToggleStop = (ingredientId: string, reason?: string) => {
    const targetIng = ingMap.get(ingredientId);
    if (!targetIng) return;

    const isStopping = !targetIng.is_stopped;

    if (!isStopping && targetIng.is_stopped && targetIng.stop_timestamp) {
      const now = Date.now();
      const newEntry: StopHistoryEntry = {
        id: generateId('h'),
        ingredientName: targetIng.name,
        stoppedAt: targetIng.stop_timestamp,
        resumedAt: now,
        reason: targetIng.stop_reason || 'Unknown',
        durationMs: now - targetIng.stop_timestamp
      };
      setStopHistory(prevHist => [newEntry, ...prevHist]);
    }

    setIngredients(prev => prev.map(ing => {
      if (ing.id === ingredientId) {
        return {
          ...ing,
          is_stopped: isStopping,
          stop_reason: isStopping ? reason : undefined,
          stop_timestamp: isStopping ? Date.now() : undefined
        };
      }
      return ing;
    }));
  };

  /**
   * Насильно ставит БЛЮДО в стоп-лист, независимо от того, есть ли ингредиенты.
   * [БД Миграция]: UPDATE dishes SET is_stopped = true WHERE id = :id
   * 
   * @param dishId Идентификатор блюда
   * @param reason Причина остановки (например, "Изменилось меню" или "Ручной стоп")
   */
  const handleToggleDishStop = (dishId: string, reason?: string) => {
    const targetDish = dishMap.get(dishId);
    if (!targetDish) return;

    const isStopping = !targetDish.is_stopped;

    if (!isStopping && targetDish.is_stopped && targetDish.stop_reason) {
      const now = Date.now();
      const stoppedAt = targetDish.stop_timestamp || (now - 1000 * 60);
      const newEntry: StopHistoryEntry = {
        id: generateId('h_dish'),
        ingredientName: `[DISH] ${targetDish.name}`,
        stoppedAt: stoppedAt,
        resumedAt: now,
        reason: targetDish.stop_reason || 'Manual',
        durationMs: now - stoppedAt
      };
      setStopHistory(prevHist => [newEntry, ...prevHist]);
    }

    setDishes(prev => prev.map(dish => {
      if (dish.id === dishId) {
        return {
          ...dish,
          is_stopped: isStopping,
          stop_reason: isStopping ? (reason || 'Manual') : '',
          stop_timestamp: isStopping ? Date.now() : undefined
        };
      }
      return dish;
    }));
  };

  /**
   * Эффект авто-синхронизации (Каскадный стоп-лист).
   * Если ингредиент уходит в "СТОП" -> все блюда с этим ингредиентом автоматически выключаются "Missing: [название сырья]".
   * При переходе на БД (PostgreSQL), этот блок стоит заменить триггером или Computed Column,
   * чтобы при загрузке `dishes` с сервера они УЖЕ прилетали с `is_stopped: true`.
   */
  useEffect(() => {
    setDishes(prevDishes => prevDishes.map(dish => {
      const stoppedIngredient = dish.ingredients.find(di => {
        const ing = ingMap.get(di.id);
        if (!ing) return false;

        if (ing.is_stopped) return true;

        if (ing.parentId) {
          const parent = ingMap.get(ing.parentId);
          if (parent?.is_stopped) return true;
        }
        return false;
      });

      const stoppedIng = stoppedIngredient
        ? ingMap.get(stoppedIngredient.id)
        : null;

      const wasAutoStopped = dish.stop_reason?.startsWith('Missing:');

      if (stoppedIng && !dish.is_stopped) {
        return { ...dish, is_stopped: true, stop_reason: `Missing: ${stoppedIng.name}` };
      } else if (!stoppedIngredient && wasAutoStopped) {
        return { ...dish, is_stopped: false, stop_reason: '' };
      }
      return dish;
    }));
  }, [ingredients, setDishes, ingMap]); 

  return {
    stopHistory,
    setStopHistory,
    handleToggleStop,
    handleToggleDishStop
  };
};
