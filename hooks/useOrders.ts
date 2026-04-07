import React, { useState, useCallback, useEffect } from 'react';
import { Order, OrderHistoryEntry, PriorityLevel, Dish, IngredientBase, SystemSettings } from '../types';
import { INITIAL_ORDERS } from '../constants';
import { generateId, calculateConsumedIngredients } from '../utils';

interface UseOrdersProps {
  settings: SystemSettings;
  dishes: Dish[];
  setDishes: React.Dispatch<React.SetStateAction<Dish[]>>;
  dishMap: Map<string, Dish>;
  ingredients: IngredientBase[];
}

/**
 * Хук для управления Очередью заказов, Парковкой столов и Историей заказов.
 * 
 * ВАЖНО ДЛЯ БУДУЩЕЙ РЕАЛИЗАЦИИ БД (PostgreSQL):
 * Этот хук — самое сердце приложения. При переходе на бекенд:
 * 1. `orders` и `orderHistory` должны быть таблицами БД.
 * 2. `handleAddTestOrder` заменяется на WebSocket/SSE/Polling из базы, откуда падают `INSERT`'s из кассовой системы (R-Keeper, iiko, и т.д.).
 * 3. Логика слияния (`table_stack`, `quantity_stack`) может происходить и на фронте (Smart Wave), но лучше переложить на бекенд.
 * 4. Авто-разпарковка стола (setInterval) заменяется на крон-джобы, либо на Computed Status: 
 *    `SELECT CASE WHEN unpark_at < NOW() THEN 'ACTIVE' ELSE 'PARKED' END as status`.
 */
export const useOrders = ({
  settings,
  dishes,
  setDishes,
  dishMap,
  ingredients
}: UseOrdersProps) => {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);

  /**
   * Добавляет новый заказ (или сливает к существующему, если включено "Aggregation Window").
   * При Smart Wave этот метод создает отдельный заказ (агрегация рисуется на клиенте `smartQueue.ts`).
   * 
   * @param dishId ID Блюда
   * @param priority Приоритет 'NORMAL' | 'VIP' | 'ULTRA' | etc.
   * @param tableNumber Номер стола
   * @param quantity Количество
   */
  const handleAddTestOrder = useCallback((dishId: string, priority: PriorityLevel, tableNumber?: number, quantity: number = 1) => {
    // Временно изменяем приоритет блюда глобально (test feature)
    setDishes(prevDishes => {
      const dishIndex = prevDishes.findIndex(d => d.id === dishId);
      if (dishIndex === -1) return prevDishes;
      const updated = [...prevDishes];
      updated[dishIndex] = { ...updated[dishIndex], priority_flag: priority };
      return updated;
    });

    setOrders(prevOrders => {
      const now = Date.now();
      const targetTableNumber = tableNumber !== undefined ? tableNumber : (Math.floor(Math.random() * 100) + 1);
      const newTableEntries = Array(quantity).fill(targetTableNumber);

      const aggregationEnabled = settings.enableAggregation !== false;
      const windowMs = settings.aggregationWindowMinutes * 60 * 1000;

      let existingOrderIndex = -1;

      // Если Aggregation Window ВКЛ и Smart Wave ВЫКЛ -> схлопываем заказы физически
      if (existingOrderIndex === -1 && aggregationEnabled && !settings.enableSmartAggregation) {
        existingOrderIndex = prevOrders.findIndex(o =>
          o.dish_id === dishId && (now - o.created_at) < windowMs
        );
      }

      if (existingOrderIndex > -1) {
        const newOrders = [...prevOrders];
        const existingOrder = newOrders[existingOrderIndex];

        const currentParkedTables = existingOrder.parked_tables || (existingOrder.was_parked ? existingOrder.table_stack.flat() : []);

        newOrders[existingOrderIndex] = {
          ...existingOrder,
          quantity_stack: [...existingOrder.quantity_stack, quantity],
          table_stack: [...existingOrder.table_stack, newTableEntries],
          parked_tables: currentParkedTables,
          updated_at: Date.now(),
          status: 'ACTIVE'
        };
        return newOrders;
      } else {
        const newOrder: Order = {
          id: generateId('o'),
          dish_id: dishId,
          quantity_stack: [quantity],
          table_stack: [newTableEntries],
          parked_tables: [],
          created_at: Date.now(),
          updated_at: Date.now(),
          status: 'ACTIVE'
        };
        return [...prevOrders, newOrder];
      }
    });
  }, [setDishes, settings]);

  /**
   * Слияние вложенных массивов количеств и столов в сплошной поток
   * Вызывается вручную пользователем со станции.
   */
  const handleStackMerge = (orderId: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const sum = o.quantity_stack.reduce((a, b) => a + b, 0);
      const allTables = o.table_stack.flat();

      return {
        ...o,
        quantity_stack: [sum],
        table_stack: [allTables]
      };
    }));
  };

  /**
   * Полное завершение приготовления блюда. (Кнопка "Готово")
   * Рассчитывает граммовку потребляемого сырья (calculateConsumedIngredients) и генерирует History Entry.
   * [БД Миграция]: UPDATE orders SET status = 'COMPLETED'
   */
  const handleCompleteOrder = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const dish = dishMap.get(order.dish_id);
    if (dish) {
      const totalOrderQty = order.quantity_stack.reduce((a, b) => a + b, 0);
      const consumedIngredients = calculateConsumedIngredients(dish, ingredients, totalOrderQty);
      const now = Date.now();
      const prepTimeMs = (now - order.created_at) + (order.accumulated_time_ms || 0);

      const historyEntry: OrderHistoryEntry = {
        id: generateId('oh'),
        dishId: dish.id,
        dishName: dish.name,
        completedAt: now,
        totalQuantity: totalOrderQty,
        prepTimeMs,
        consumedIngredients,
        was_parked: order.was_parked,
        snapshot: order
      };
      setOrderHistory(prevHistory => [historyEntry, ...prevHistory]);
    }

    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  /**
   * Частичная отдача заказа. (Например, из 5 порций готовы только 3).
   * Выдает 3 штуки порции (отправляет их в order_history), а 2 оставляет в ACTIVE очереди.
   */
  const handlePartialComplete = (orderId: string, quantityToComplete: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const dish = dishMap.get(order.dish_id);
    if (dish) {
      const consumedIngredients = calculateConsumedIngredients(dish, ingredients, quantityToComplete);
      const now = Date.now();
      const prepTimeMs = (now - order.created_at) + (order.accumulated_time_ms || 0);
      const allOriginalTables = order.table_stack.flat();
      const completedTables = allOriginalTables.slice(0, quantityToComplete);

      const historyEntry: OrderHistoryEntry = {
        id: generateId('oh_part'),
        dishId: dish.id,
        dishName: dish.name + " (Partial)",
        completedAt: now,
        totalQuantity: quantityToComplete,
        prepTimeMs,
        consumedIngredients,
        was_parked: order.was_parked,
        snapshot: {
          ...order,
          quantity_stack: [quantityToComplete],
          table_stack: [completedTables]
        }
      };
      setOrderHistory(prevHistory => [historyEntry, ...prevHistory]);
    }

    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;

      const newStack = [...o.quantity_stack];
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

      let currentTables = o.table_stack.flat();
      if (currentTables.length > quantityToComplete) {
        currentTables = currentTables.slice(quantityToComplete);
      } else {
        currentTables = [];
      }

      return {
        ...o,
        quantity_stack: cleanedStack,
        table_stack: [currentTables]
      };
    }));
  };

  /**
   * Отмена заказа без ухода в историю.
   * [БД Миграция]: UPDATE orders SET status = 'CANCELLED'
   */
  const handleCancelOrder = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  /**
   * UNDO ф-я. Извлекает заказ из order_history и возвращает его в active orders.
   * Полезно если повар случайно нажал "Готово".
   */
  const handleRestoreOrder = (historyId: string) => {
    const entry = orderHistory.find(h => h.id === historyId);
    if (!entry || !entry.snapshot) return;

    const restoredOrder = entry.snapshot;

    setOrders(currentOrders => {
      const existingOrderIndex = currentOrders.findIndex(o => o.id === restoredOrder.id);

      if (existingOrderIndex > -1) {
        const updatedOrders = [...currentOrders];
        const existing = updatedOrders[existingOrderIndex];

        updatedOrders[existingOrderIndex] = {
          ...existing,
          quantity_stack: [...existing.quantity_stack, ...restoredOrder.quantity_stack],
          table_stack: [...existing.table_stack, ...restoredOrder.table_stack],
        };
        return updatedOrders;
      } else {
        return [...currentOrders, { ...restoredOrder, status: 'ACTIVE' }];
      }
    });

    setOrderHistory(prev => prev.filter(h => h.id !== historyId));
  };

  /**
   * Ставит стол "на паузу" (Парковка). 
   * Если в заказе совмещены порции паркуемого стола и другого (активного) стола, производит Split (разделение чеков).
   * 
   * @param tableNumber Номер стола для парковки
   * @param returnTimestamp Unix time когда стол должен вернуться в выдачу
   */
  const handleParkTable = (tableNumber: number, returnTimestamp: number) => {
    const now = Date.now();
    setOrders(prev => prev.flatMap(o => {
      const tablesInStack = o.table_stack ? o.table_stack.flat() : (o.table_numbers || []);
      const hasTargetTable = tablesInStack.includes(tableNumber);

      if (!hasTargetTable || o.status === 'PARKED') {
        return [o];
      }

      const newActiveTableStack: number[][] = [];
      const newActiveQuantityStack: number[] = [];

      const newParkedTableStack: number[][] = [];
      const newParkedQuantityStack: number[] = [];

      const currentParkedTables = o.parked_tables || (o.was_parked ? o.table_stack.flat() : []);

      o.table_stack.forEach((blockTables) => {
        const staying = blockTables.filter((t) => t !== tableNumber);
        const leaving = blockTables.filter((t) => t === tableNumber);

        if (staying.length > 0) {
          newActiveTableStack.push(staying);
          newActiveQuantityStack.push(staying.length);
        }

        if (leaving.length > 0) {
          newParkedTableStack.push(leaving);
          newParkedQuantityStack.push(leaving.length);
        }
      });

      const timeElapsedSoFar = now - (o.created_at || now);

      if (newActiveTableStack.length === 0) {
        const allTargetTables = o.table_stack.flat();
        const updatedParkedTables = Array.from(new Set([...currentParkedTables, ...allTargetTables]));

        return [
          {
            ...o,
            status: 'PARKED',
            parked_at: now,
            unpark_at: returnTimestamp,
            accumulated_time_ms: (o.accumulated_time_ms || 0) + timeElapsedSoFar,
            was_parked: true,
            parked_tables: updatedParkedTables,
          },
        ];
      }

      const activeOrderPart: Order = {
        ...o,
        quantity_stack: newActiveQuantityStack,
        table_stack: newActiveTableStack,
        parked_tables: currentParkedTables.filter((t) => t !== tableNumber),
      };

      const parkedOrderPart: Order = {
        ...o,
        id: generateId('o_parked'),
        status: 'PARKED',
        quantity_stack: newParkedQuantityStack,
        table_stack: newParkedTableStack,
        parked_tables: Array.from(new Set([...tablesInStack.filter((t) => t === tableNumber)])),
        parked_at: now,
        unpark_at: returnTimestamp,
        accumulated_time_ms: (o.accumulated_time_ms || 0) + timeElapsedSoFar,
        was_parked: true,
      };

      return [activeOrderPart, parkedOrderPart];
    }));
  };

  /**
   * Мгновенный возврат всех заказов стола с парковки в 'ACTIVE'.
   */
  const handleUnparkNow = (tableNumber: number) => {
    const now = Date.now();
    setOrders(prev => prev.map(o => {
      const belongsToTable = o.table_stack
        ? o.table_stack.flat().includes(tableNumber)
        : false;

      if (belongsToTable && o.status === 'PARKED') {
        return {
          ...o,
          status: 'ACTIVE',
          parked_at: undefined,
          unpark_at: undefined,
          created_at: now
        };
      }
      return o;
    }));
  };

  /**
   * Гранулярная выгрузка из парковки (только выбранные заказы).
   */
  const handleUnparkOrders = (orderIds: string[]) => {
    const now = Date.now();
    setOrders(prev => prev.map(o => {
      if (orderIds.includes(o.id) && o.status === 'PARKED') {
        return {
          ...o,
          status: 'ACTIVE',
          parked_at: undefined,
          unpark_at: undefined,
          created_at: now
        };
      }
      return o;
    }));
  };

  /**
   * Системный CRON: каждые 10 секунд проверяет запаркованные столы.
   * Если время ожидания (`unpark_at`) вышло, то меняет их статус обратно на `ACTIVE`.
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setOrders(prevOrders => {
        let hasChanges = false;
        const nextOrders = prevOrders.map(o => {
          if (o.status === 'PARKED' && o.unpark_at && now >= o.unpark_at) {
            hasChanges = true;
            return {
              ...o,
              status: 'ACTIVE',
              parked_at: undefined,
              unpark_at: undefined,
              created_at: now
            } as Order;
          }
          return o;
        });
        return hasChanges ? nextOrders : prevOrders;
      });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return {
    orders,
    setOrders,
    orderHistory,
    setOrderHistory,
    handleAddTestOrder,
    handleStackMerge,
    handleCompleteOrder,
    handlePartialComplete,
    handleCancelOrder,
    handleRestoreOrder,
    handleParkTable,
    handleUnparkNow,
    handleUnparkOrders
  };
};
