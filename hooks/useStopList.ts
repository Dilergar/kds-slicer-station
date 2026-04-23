import React, { useState, useEffect, useCallback } from 'react';
import { IngredientBase, Dish, StopHistoryEntry, AuthUser } from '../types';
import { toggleStop, fetchStopHistory } from '../services/stoplistApi';

interface UseStopListProps {
  ingredients: IngredientBase[];
  setIngredients: React.Dispatch<React.SetStateAction<IngredientBase[]>>;
  ingMap: Map<string, IngredientBase>;
  dishes: Dish[];
  setDishes: React.Dispatch<React.SetStateAction<Dish[]>>;
  dishMap: Map<string, Dish>;
  reloadIngredients: () => Promise<void>;
  reloadDishes: () => Promise<void>;
  // Залогиненный юзер. Прокидывается в toggle, backend пишет его в
  // slicer_stop_history.stopped_by_* / resumed_by_*. Если null (по идее
  // невозможно — App рендерит useStopList только после login) — actor
  // уйдёт как NULL и запись сохранится без имени актора.
  user: AuthUser | null;
}

/**
 * Хук для управления стоп-листами ингредиентов и блюд.
 *
 * Персистентность и каскадная логика — на backend:
 *  - slicer_ingredients.is_stopped   — состояние ингредиента
 *  - slicer_dish_stoplist            — актуальный стоп-лист блюд (MANUAL/CASCADE)
 *  - slicer_stop_history             — лог завершённых стопов для Dashboard
 *
 * После любого toggle-вызова хук перезагружает ingredients И dishes из БД,
 * чтобы подхватить каскадные изменения блюд, которые backend применил в
 * той же транзакции.
 *
 * Фронтенд больше НЕ содержит каскадной логики — она полностью живёт в
 * recalculateCascadeStops() на backend (server/src/routes/stoplist.ts).
 */
export const useStopList = ({
  ingredients,
  setIngredients,
  ingMap,
  dishes,
  setDishes,
  dishMap,
  reloadIngredients,
  reloadDishes,
  user,
}: UseStopListProps) => {
  const [stopHistory, setStopHistory] = useState<StopHistoryEntry[]>([]);

  /** Загрузка истории стопов из БД */
  const loadStopHistory = useCallback(async () => {
    try {
      const data = await fetchStopHistory();
      setStopHistory(data);
    } catch (err) {
      console.error('[useStopList] Ошибка загрузки истории:', err);
    }
  }, []);

  useEffect(() => {
    loadStopHistory();
  }, [loadStopHistory]);

  /**
   * Переключить стоп-лист ингредиента.
   *
   * Поток:
   *  1. Оптимистичное обновление локального стейта для мгновенного отклика UI
   *  2. POST /api/stoplist/toggle — backend в одной транзакции обновляет
   *     slicer_ingredients, пишет историю при снятии и вызывает
   *     recalculateCascadeStops() — каскадные стопы блюд обновляются в БД.
   *  3. reloadIngredients + reloadDishes — подтягиваем свежее состояние
   *     (включая каскадные изменения блюд) из БД.
   *  4. loadStopHistory — обновляем Dashboard.
   */
  const handleToggleStop = useCallback(async (ingredientId: string, reason?: string) => {
    const targetIng = ingMap.get(ingredientId);
    if (!targetIng) return;

    const isStopping = !targetIng.is_stopped;

    // Оптимистичное обновление — видим эффект мгновенно
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

    try {
      await toggleStop({
        targetId: ingredientId,
        targetType: 'ingredient',
        reason,
        actorUuid: user?.uuid,
        actorName: user?.login,
      });
      // Каскадные стопы блюд обновились на backend — подтягиваем оба списка
      await Promise.all([reloadIngredients(), reloadDishes()]);
      await loadStopHistory();
    } catch (err) {
      console.error('[useStopList] Ошибка toggle ингредиента:', err);
      // Откатываемся к реальному состоянию БД
      await Promise.all([reloadIngredients(), reloadDishes()]);
    }
  }, [ingMap, setIngredients, reloadIngredients, reloadDishes, loadStopHistory, user]);

  /**
   * Переключить стоп-лист блюда (ручной стоп).
   *
   * Backend в одной транзакции:
   *  - UPSERT в slicer_dish_stoplist с stop_type='MANUAL'
   *  - при снятии пишет историю и вызывает recalculateCascadeStops
   *    (если ингредиент всё ещё стопнут, блюдо автоматически останется
   *    на каскадном стопе)
   */
  const handleToggleDishStop = useCallback(async (dishId: string, reason?: string) => {
    const targetDish = dishMap.get(dishId);
    if (!targetDish) return;

    const isStopping = !targetDish.is_stopped;

    // Оптимистичное обновление для мгновенного отклика
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

    try {
      await toggleStop({
        targetId: dishId,
        targetType: 'dish',
        reason,
        dishName: targetDish.name,
        isStopping,
        actorUuid: user?.uuid,
        actorName: user?.login,
      });
      // Подтягиваем персистентное состояние — оно теперь в slicer_dish_stoplist
      await reloadDishes();
      await loadStopHistory();
    } catch (err) {
      console.error('[useStopList] Ошибка toggle блюда:', err);
      await reloadDishes();
    }
  }, [dishMap, setDishes, reloadDishes, loadStopHistory, user]);

  return {
    stopHistory,
    setStopHistory,
    handleToggleStop,
    handleToggleDishStop
  };
};
