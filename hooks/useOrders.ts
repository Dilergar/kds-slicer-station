import { useState, useCallback, useEffect, useRef } from 'react';
import { Order, OrderHistoryEntry, Dish, IngredientBase, SystemSettings } from '../types';
import { calculateConsumedIngredients } from '../utils';
import {
  fetchOrders,
  completeOrder,
  partialCompleteOrder,
  cancelOrder,
  parkOrder,
  unparkOrder,
  mergeOrder,
  fetchOrderHistory,
  deleteOrderHistory,
  restoreOrder,
  startDefrost,
  cancelDefrost,
  completeDefrost
} from '../services/ordersApi';

interface UseOrdersProps {
  settings: SystemSettings;
  dishes: Dish[];
  dishMap: Map<string, Dish>;
  ingredients: IngredientBase[];
}

/**
 * Хук для управления Очередью заказов, Парковкой столов и Историей заказов.
 *
 * Заказы загружаются из PostgreSQL через polling каждые 4 секунды.
 * Все действия (complete, park, unpark, cancel, merge) отправляются через API.
 * Авто-разпарковка выполняется на backend при каждом GET /api/orders.
 */
export const useOrders = ({
  settings,
  dishes,
  dishMap,
  ingredients
}: UseOrdersProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Ref для предотвращения одновременных polling-запросов
  const pollingRef = useRef(false);

  /**
   * Загрузка активных заказов из БД.
   * Вызывается при монтировании и каждые 4 секунды (polling).
   */
  const loadOrders = useCallback(async () => {
    // Пропускаем если предыдущий запрос ещё выполняется
    if (pollingRef.current) return;
    pollingRef.current = true;

    try {
      const data = await fetchOrders();
      setOrders(data);
    } catch (err) {
      console.error('[useOrders] Ошибка загрузки заказов:', err);
    } finally {
      pollingRef.current = false;
      setLoading(false);
    }
  }, []);

  /** Загрузка истории заказов из БД */
  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchOrderHistory();
      setOrderHistory(data);
    } catch (err) {
      console.error('[useOrders] Ошибка загрузки истории:', err);
    }
  }, []);

  // Polling заказов каждые 4 секунды
  useEffect(() => {
    loadOrders();
    loadHistory();
    const interval = setInterval(() => {
      loadOrders();
      loadHistory();
    }, 4000);
    return () => clearInterval(interval);
  }, [loadOrders, loadHistory]);

  /**
   * Объединение стеков (Merge). Отправляет на backend.
   */
  const handleStackMerge = useCallback(async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const sum = order.quantity_stack.reduce((a, b) => a + b, 0);
    const allTables = order.table_stack.flat();

    // Оптимистичное обновление UI
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return { ...o, quantity_stack: [sum], table_stack: [allTables] };
    }));

    try {
      await mergeOrder(orderId, { quantityStack: [sum], tableStack: [allTables] });
    } catch (err) {
      console.error('[useOrders] Ошибка merge:', err);
      await loadOrders(); // Откатываем к реальным данным
    }
  }, [orders, loadOrders]);

  /**
   * Полное завершение заказа.
   * Отправляет на backend: обновляет docm2tabl1_cooked, создаёт историю и расход.
   */
  const handleCompleteOrder = useCallback(async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const dish = dishMap.get(order.dish_id);
    if (!dish) return;

    const totalOrderQty = order.quantity_stack.reduce((a, b) => a + b, 0);
    const consumedIngredients = calculateConsumedIngredients(dish, ingredients, totalOrderQty);
    const now = Date.now();
    // Вариант Б: accumulated_time_ms теперь «время парковок», вычитаем из общего.
    const prepTimeMs = Math.max(0, (now - order.created_at) - (order.accumulated_time_ms || 0));

    // Оптимистичное удаление из UI
    setOrders(prev => prev.filter(o => o.id !== orderId));

    try {
      await completeOrder(orderId, {
        dishId: dish.id,
        dishName: dish.name,
        totalQuantity: totalOrderQty,
        prepTimeMs,
        wasParked: order.was_parked,
        snapshot: order,
        consumedIngredients
      });
      await loadHistory(); // Обновить историю
    } catch (err) {
      console.error('[useOrders] Ошибка complete:', err);
      await loadOrders(); // Откатываем
    }
  }, [orders, dishMap, ingredients, loadOrders, loadHistory]);

  /**
   * Частичная отдача заказа.
   */
  const handlePartialComplete = useCallback(async (orderId: string, quantityToComplete: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const dish = dishMap.get(order.dish_id);
    if (!dish) return;

    const consumedIngredients = calculateConsumedIngredients(dish, ingredients, quantityToComplete);
    const now = Date.now();
    // Вариант Б: accumulated_time_ms теперь «время парковок», вычитаем из общего.
    const prepTimeMs = Math.max(0, (now - order.created_at) - (order.accumulated_time_ms || 0));

    // Вычисляем оставшийся стек
    const newStack = [...order.quantity_stack];
    let remainingToRemove = quantityToComplete;
    for (let i = 0; i < newStack.length; i++) {
      if (remainingToRemove <= 0) break;
      if (newStack[i] > remainingToRemove) {
        newStack[i] -= remainingToRemove;
        remainingToRemove = 0;
      } else {
        remainingToRemove -= newStack[i];
        newStack[i] = 0;
      }
    }
    const cleanedStack = newStack.filter(q => q > 0);
    let currentTables = order.table_stack.flat();
    currentTables = currentTables.length > quantityToComplete
      ? currentTables.slice(quantityToComplete)
      : [];

    const allOriginalTables = order.table_stack.flat();
    const completedTables = allOriginalTables.slice(0, quantityToComplete);

    // Оптимистичное обновление UI
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return { ...o, quantity_stack: cleanedStack, table_stack: [currentTables] };
    }));

    try {
      await partialCompleteOrder(orderId, {
        dishId: dish.id,
        dishName: dish.name,
        quantityToComplete,
        prepTimeMs,
        wasParked: order.was_parked,
        snapshot: { ...order, quantity_stack: [quantityToComplete], table_stack: [completedTables] },
        consumedIngredients,
        remainingQuantityStack: cleanedStack,
        remainingTableStack: [currentTables]
      });
      await loadHistory();
    } catch (err) {
      console.error('[useOrders] Ошибка partial-complete:', err);
      await loadOrders();
    }
  }, [orders, dishMap, ingredients, loadOrders, loadHistory]);

  /**
   * Отмена заказа через API.
   */
  const handleCancelOrder = useCallback(async (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await cancelOrder(orderId);
    } catch (err) {
      console.error('[useOrders] Ошибка cancel:', err);
      await loadOrders();
    }
  }, [loadOrders]);

  /**
   * Восстановление заказа из истории (UNDO).
   *
   * Логика:
   * 1. Считаем финальные quantity_stack/table_stack: если позиция уже
   *    висит на доске (остаток после partial) — конкатенируем со снапшотом;
   *    иначе снапшот сам по себе.
   * 2. Оптимистично кладём в локальный state + выкидываем из истории.
   * 3. Отправляем на backend: POST /api/orders/:id/restore — UPSERT
   *    slicer_order_state (status=ACTIVE, новые stacks, finished_at=NULL).
   *    Это критично: без этого шага следующий polling через 4с перезапишет
   *    локальный state значением из БД и восстановление исчезнет — тот
   *    самый баг «вернул → суп слегка мелькнул → пропал навсегда».
   * 4. Удаляем запись из истории на backend (DELETE /api/history/orders/:id).
   *    Порядок важен: сначала restore, потом delete — если первый упал,
   *    история ещё на месте и пользователь может попробовать снова.
   */
  const handleRestoreOrder = useCallback(async (historyId: string) => {
    const entry = orderHistory.find(h => h.id === historyId);
    if (!entry || !entry.snapshot) return;

    const restoredOrder = entry.snapshot;

    // Вычисляем финальный стек ДО оптимистичного обновления, чтобы отправить то же самое на backend.
    const existing = orders.find(o => o.id === restoredOrder.id);
    const newQuantityStack = existing
      ? [...existing.quantity_stack, ...restoredOrder.quantity_stack]
      : restoredOrder.quantity_stack;
    const newTableStack = existing
      ? [...existing.table_stack, ...restoredOrder.table_stack]
      : restoredOrder.table_stack;

    // Оптимистичное обновление UI
    setOrders(prev => {
      const existingIndex = prev.findIndex(o => o.id === restoredOrder.id);
      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          status: 'ACTIVE' as const,
          quantity_stack: newQuantityStack,
          table_stack: newTableStack,
        };
        return updated;
      }
      return [...prev, { ...restoredOrder, status: 'ACTIVE' as const, quantity_stack: newQuantityStack, table_stack: newTableStack }];
    });
    setOrderHistory(prev => prev.filter(h => h.id !== historyId));

    try {
      // Вернуть в slicer_order_state: без этого polling через 4с перезатрёт локальное состояние.
      await restoreOrder(restoredOrder.id, {
        quantityStack: newQuantityStack,
        tableStack: newTableStack,
      });
      await deleteOrderHistory(historyId);
    } catch (err) {
      console.error('[useOrders] Ошибка restore:', err);
      await loadOrders();
      await loadHistory();
    }
  }, [orderHistory, orders, loadOrders, loadHistory]);

  /**
   * Парковка стола. Отправляет на backend.
   */
  const handleParkTable = useCallback(async (tableNumber: number, returnTimestamp: number) => {
    const now = Date.now();

    // Собираем заказы, которые нужно паркануть
    const affectedOrders = orders.filter(o => {
      const tablesInStack = o.table_stack ? o.table_stack.flat() : [];
      return tablesInStack.includes(tableNumber) && o.status !== 'PARKED';
    });

    if (affectedOrders.length === 0) return;

    // Оптимистичное обновление UI.
    // Вариант Б (миграция 019): accumulated_time_ms НЕ трогаем при парковке
    // (накопление при /unpark), created_at тоже не трогаем. Просто переводим
    // в PARKED и ставим parked_at=now. Формула таймера на карточке ставит
    // pivot=parked_at когда PARKED → таймер замирает на момент парковки.
    setOrders(prev => prev.flatMap(o => {
      const tablesInStack = o.table_stack ? o.table_stack.flat() : [];
      const hasTargetTable = tablesInStack.includes(tableNumber);
      if (!hasTargetTable || o.status === 'PARKED') return [o];

      const currentParkedTables = o.parked_tables || [];
      const allTargetTables = o.table_stack.flat();
      const updatedParkedTables = Array.from(new Set([...currentParkedTables, ...allTargetTables]));

      return [{
        ...o,
        status: 'PARKED' as const,
        parked_at: now,
        unpark_at: returnTimestamp,
        was_parked: true,
        parked_tables: updatedParkedTables,
      }];
    }));

    // Отправляем каждый затронутый заказ на backend.
    // `parkedTables` = ВСЕ столы стека (дедуплицированные): парковка переводит
    // весь заказ в PARKED (split не реализован). `accumulatedTimeMs` передаём
    // как есть — backend его использует только при INSERT новой строки,
    // на UPDATE игнорирует (накопление при /unpark).
    for (const order of affectedOrders) {
      const allTablesUnique: number[] = Array.from(new Set<number>(order.table_stack.flat()));
      try {
        await parkOrder(order.id, {
          quantityStack: order.quantity_stack,
          tableStack: order.table_stack,
          parkedTables: allTablesUnique,
          unparkAt: returnTimestamp,
          accumulatedTimeMs: order.accumulated_time_ms || 0
        });
      } catch (err) {
        console.error('[useOrders] Ошибка park:', err);
      }
    }
  }, [orders]);

  /**
   * Оптимистичный апдейт Order при разпарковке (Вариант Б, миграция 019):
   *   - Ручная парковка: accumulated_time_ms += (now - parked_at) — заказ
   *     остаётся на историческом месте в очереди по ordertime.
   *   - Автопарковка (parked_by_auto=TRUE): сбрасываем accumulated=0 и
   *     created_at=now — десерт встаёт «как новый» в конец очереди.
   * Без знания parked_by_auto на фронте (до полной синхронизации) этот оптимистичный
   * рендер можно отличить по нашему флагу в Order. Поле присутствует после
   * polling из backend (миграция 019). Если флага нет — считаем ручной.
   */
  const applyUnparkOptimistic = (o: Order, now: number): Order => {
    const wasAuto = (o as Order & { parked_by_auto?: boolean }).parked_by_auto === true;
    const elapsedInPark = o.parked_at ? (now - o.parked_at) : 0;
    if (wasAuto) {
      return {
        ...o,
        status: 'ACTIVE',
        parked_at: undefined,
        unpark_at: undefined,
        accumulated_time_ms: 0,
        created_at: now,
      };
    }
    return {
      ...o,
      status: 'ACTIVE',
      parked_at: undefined,
      unpark_at: undefined,
      accumulated_time_ms: (o.accumulated_time_ms || 0) + elapsedInPark,
      // created_at НЕ меняем — сортировка по историческому ordertime.
    };
  };

  /**
   * Мгновенный возврат стола с парковки через API.
   */
  const handleUnparkNow = useCallback(async (tableNumber: number) => {
    const parkedOrders = orders.filter(o =>
      o.status === 'PARKED' && o.table_stack?.flat().includes(tableNumber)
    );

    const now = Date.now();
    setOrders(prev => prev.map(o => {
      const belongsToTable = o.table_stack?.flat().includes(tableNumber);
      if (belongsToTable && o.status === 'PARKED') {
        return applyUnparkOptimistic(o, now);
      }
      return o;
    }));

    for (const order of parkedOrders) {
      try {
        await unparkOrder(order.id);
      } catch (err) {
        console.error('[useOrders] Ошибка unpark:', err);
      }
    }
  }, [orders]);

  /**
   * Гранулярная выгрузка из парковки (только выбранные заказы).
   */
  const handleUnparkOrders = useCallback(async (orderIds: string[]) => {
    const now = Date.now();
    setOrders(prev => prev.map(o => {
      if (orderIds.includes(o.id) && o.status === 'PARKED') {
        return applyUnparkOptimistic(o, now);
      }
      return o;
    }));

    for (const id of orderIds) {
      try {
        await unparkOrder(id);
      } catch (err) {
        console.error('[useOrders] Ошибка unpark:', err);
      }
    }
  }, []);

  // ======================================================================
  // Разморозка (миграция 016)
  // Все три действия идут на один набор реальных order_item_id. Для Smart
  // Wave их несколько (стек 1+1+1), для стандартного режима — один. Вызывающий
  // код передаёт sourceOrderItemIds (или undefined если id уже реальный).
  // ======================================================================

  /**
   * Запустить таймер разморозки. Оптимистично проставляем defrost_started_at
   * = now + snapshot duration per-dish (миграция 020) из dishMap, чтобы
   * мини-карточка появилась мгновенно, не дожидаясь ближайшего polling
   * через 4 сек. Бэкенд пересчитает duration аутентично из slicer_dish_defrost
   * и следующий polling синхронизирует значение.
   */
  const handleStartDefrost = useCallback(async (
    orderId: string,
    sourceOrderItemIds?: string[]
  ) => {
    const ids = sourceOrderItemIds && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [orderId];

    // Резолвим dish_id первого item'а → длительность в минутах из справочника
    // блюд. Smart Wave гарантирует одинаковое блюдо на всех items группы,
    // поэтому достаточно первого. Фолбэк 15 мин если блюдо почему-то не
    // нашлось в dishMap.
    const firstId = ids[0];
    const firstOrder = orders.find(o => o.id === firstId);
    const dish = firstOrder ? dishMap.get(firstOrder.dish_id) : undefined;
    const durationSec = (dish?.defrost_duration_minutes ?? 15) * 60;
    const now = Date.now();

    setOrders(prev => prev.map(o => {
      if (!ids.includes(o.id)) return o;
      return { ...o, defrost_started_at: now, defrost_duration_seconds: durationSec };
    }));

    try {
      await startDefrost(orderId, sourceOrderItemIds);
    } catch (err) {
      console.error('[useOrders] Ошибка defrost-start:', err);
      await loadOrders();
    }
  }, [orders, dishMap, loadOrders]);

  /** Отменить разморозку — возвращает карточку в очередь с исходным ULTRA. */
  const handleCancelDefrost = useCallback(async (
    orderId: string,
    sourceOrderItemIds?: string[]
  ) => {
    const ids = sourceOrderItemIds && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [orderId];

    setOrders(prev => prev.map(o => {
      if (!ids.includes(o.id)) return o;
      return { ...o, defrost_started_at: null, defrost_duration_seconds: null };
    }));

    try {
      await cancelDefrost(orderId, sourceOrderItemIds);
    } catch (err) {
      console.error('[useOrders] Ошибка defrost-cancel:', err);
      await loadOrders();
    }
  }, [loadOrders]);

  /**
   * «Разморозилась» — ручное подтверждение раньше таймера. Оптимистично
   * бэкдейтим started_at на (duration+1) сек назад, чтобы мини-карточка
   * исчезла мгновенно и позиция сразу вернулась в очередь. ULTRA-статус
   * сохраняется (раз блюдо ULTRA — остаётся ULTRA и после разморозки).
   */
  const handleCompleteDefrost = useCallback(async (
    orderId: string,
    sourceOrderItemIds?: string[]
  ) => {
    const ids = sourceOrderItemIds && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [orderId];
    const now = Date.now();

    setOrders(prev => prev.map(o => {
      if (!ids.includes(o.id) || !o.defrost_started_at) return o;
      const durationSec = o.defrost_duration_seconds ?? 0;
      return {
        ...o,
        defrost_started_at: now - (durationSec + 1) * 1000
      };
    }));

    try {
      await completeDefrost(orderId, sourceOrderItemIds);
    } catch (err) {
      console.error('[useOrders] Ошибка defrost-complete:', err);
      await loadOrders();
    }
  }, [loadOrders]);

  return {
    orders,
    setOrders,
    orderHistory,
    setOrderHistory,
    loading,
    handleStackMerge,
    handleCompleteOrder,
    handlePartialComplete,
    handleCancelOrder,
    handleRestoreOrder,
    handleParkTable,
    handleUnparkNow,
    handleUnparkOrders,
    handleStartDefrost,
    handleCancelDefrost,
    handleCompleteDefrost
  };
};
