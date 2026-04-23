/**
 * SlicerStation.tsx — Основная KDS-доска (Kitchen Display System)
 *
 * Главный экран нарезчика: карточки заказов, парковка, история.
 *
 * Режимы очереди:
 * 1. Smart Wave Aggregation (ON по умолчанию):
 *    - Вызывает buildSmartQueue() из smartQueue.ts
 *    - SmartQueueGroup[] → виртуальные Order[] для OrderCard
 *    - Стабильный virtual ID: smart_${dishId}_${sourceOrderIds}
 *    - Stack-структура сохраняется (каждый source = блок) → показывает "1+1"
 *    - mergedVirtualIds: локальный state для трекинга merged виртуальных заказов
 *    - Done/PartDone/Merge резолвятся через smartQueueMappingRef
 *
 * 2. Стандартная сортировка (Smart Wave OFF):
 *    - ULTRA → COURSE_FIFO по sort_index категории → FIFO по created_at
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dish, Order, Category, IngredientBase, PriorityLevel, OrderHistoryEntry, SystemSettings, SmartQueueGroup } from '../types';
import { Clock, Flame, Check, Layers, AlertTriangle, PauseCircle, Car, X, CalendarClock, History, Undo, ArrowLeft, MoveLeft, ArrowUp, PieChart } from 'lucide-react';
import { PartialCompletionModal } from './PartialCompletionModal';
import { OrderCard } from './OrderCard';
import { DefrostRow } from './DefrostRow';
import { DefrostModal } from './DefrostModal';
import { buildSmartQueue, isDefrostActive, hasDefrostBeenStarted } from '../smartQueue';

interface SlicerStationProps {
  orders: Order[];
  dishes: Dish[];
  categories: Category[];
  ingredients: IngredientBase[];
  onCompleteOrder: (orderId: string) => void;
  onStackMerge: (orderId: string) => void;
  onAddTestOrder: (dishId: string, priority: PriorityLevel) => void;
  onPreviewImage: (url: string) => void;
  onParkTable: (tableNumber: number, returnTimestamp: number) => void;
  onUnparkTable: (tableNumber: number) => void;
  onUnparkOrders?: (orderIds: string[]) => void;
  onCancelOrder?: (orderId: string) => void;
  onPartialComplete?: (orderId: string, quantity: number) => void;
  orderHistory?: OrderHistoryEntry[];
  onRestoreOrder?: (id: string) => void;
  settings?: SystemSettings;
  // Разморозка (миграция 016). Все три принимают sourceOrderItemIds для
  // Smart Wave: резолв виртуального id → реальные order_item_id делается
  // здесь внутри через smartQueueMappingRef.
  onStartDefrost?: (orderId: string, sourceOrderItemIds?: string[]) => void;
  onCancelDefrost?: (orderId: string, sourceOrderItemIds?: string[]) => void;
  onCompleteDefrost?: (orderId: string, sourceOrderItemIds?: string[]) => void;
}

export const SlicerStation: React.FC<SlicerStationProps> = ({
  orders,
  dishes,
  categories,
  ingredients,
  onCompleteOrder,
  onStackMerge,
  onAddTestOrder,
  onPreviewImage,
  onParkTable,
  onUnparkTable,
  onUnparkOrders,
  onPartialComplete,
  onCancelOrder,
  orderHistory = [],
  onRestoreOrder,
  settings,
  onStartDefrost,
  onCancelDefrost,
  onCompleteDefrost
}) => {
  const retentionMinutes = settings?.historyRetentionMinutes || 60;
  const [showTestModal, setShowTestModal] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Timer update
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const [showParkModal, setShowParkModal] = useState(false);
  const [showParkingList, setShowParkingList] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Filter Active Orders Only
  const activeOrders = useMemo(() => orders.filter(o => o.status === 'ACTIVE' || o.status === undefined), [orders]);

  // Count parked tables (approximate by unique table numbers in parked orders)
  const parkedTablesCount = useMemo(() => {
    const parked = orders.filter(o => o.status === 'PARKED');
    const tables = new Set<number>();
    parked.forEach(o => {
      if (o.table_stack) {
        o.table_stack.flat().forEach(t => tables.add(t));
      }
    });
    return tables.size;
  }, [orders]);

  // === Маппинг виртуальных ID → реальные source orders (для Smart Aggregation) ===
  // Ключ: virtualOrderId, Значение: { sourceOrderIds, itemCountByOrder }
  const smartQueueMappingRef = useRef<Map<string, { sourceOrderIds: string[], itemCountByOrder: Map<string, number> }>>(new Map());

  // === Трекинг виртуальных заказов, которые были "merged" (нажата кнопка объединения) ===
  const [mergedVirtualIds, setMergedVirtualIds] = useState<Set<string>>(new Set());

  // === «В работе» — локальный визуальный claim карточки ===
  // Чисто UI-состояние для координации двух нарезчиков за одним планшетом:
  // тап по карточке → неоновая рамка + 🔪 у количества порции. Повторный
  // тап снимает. Не пишется в БД, не переживает F5, не участвует в отчётах —
  // только сигнал «эту уже кто-то взял, не трогай».
  const [inWorkIds, setInWorkIds] = useState<Set<string>>(new Set());

  const toggleInWork = useCallback((orderId: string) => {
    setInWorkIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // === Разморозка: группировка и маппинг (миграция 016) ===
  // Группируем активно размораживающиеся заказы по (dish_id + started_at с
  // точностью до 5 сек). Это объединяет Smart Wave «вспышки» (когда клик по
  // одной виртуальной карточке стартует разморозку на 3 реальных order_item_id)
  // в одну мини-карточку, но оставляет независимые разморозки того же блюда
  // в разное время как отдельные карточки. Каждой группе выдаём синтетический
  // Order — им кормим DefrostRow и DefrostModal как обычной карточкой.
  const defrostingGroups = useMemo(() => {
    const BUCKET_MS = 5000; // допуск между связанными source_order_id
    const groups = new Map<string, {
      virtualId: string;
      dishId: string;
      startedAt: number;
      durationSec: number;
      earliestCreatedAt: number;
      sourceOrderIds: string[];
      totalQuantity: number;
      tableBlocks: number[][];
      accumulatedTimeMs: number;
    }>();

    for (const o of orders) {
      if (!isDefrostActive(o, now)) continue;
      const bucket = Math.floor((o.defrost_started_at ?? 0) / BUCKET_MS);
      const key = `${o.dish_id}_${bucket}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          virtualId: `defrost_${o.dish_id}_${bucket}`,
          dishId: o.dish_id,
          startedAt: o.defrost_started_at!,
          durationSec: o.defrost_duration_seconds ?? 0,
          earliestCreatedAt: o.created_at,
          sourceOrderIds: [],
          totalQuantity: 0,
          tableBlocks: [],
          accumulatedTimeMs: 0,
        };
        groups.set(key, g);
      }
      g.sourceOrderIds.push(o.id);
      // Для FIFO внутри карточки берём самый ранний created_at — соответствует
      // логике Smart Wave (earliestOrderTime группы).
      if (o.created_at < g.earliestCreatedAt) g.earliestCreatedAt = o.created_at;
      // Аккумулируем время (накопленное из парковки) — максимум по группе.
      if ((o.accumulated_time_ms ?? 0) > g.accumulatedTimeMs) {
        g.accumulatedTimeMs = o.accumulated_time_ms ?? 0;
      }
      const qty = o.quantity_stack.reduce((a, b) => a + b, 0);
      g.totalQuantity += qty;
      // Столы: каждый source order вносит свой блок. Если столов нет — пустой
      // блок пропускаем, иначе table_stack в синтетическом Order будет [[]]
      // и OrderCard нарисует пустые строки.
      const tables = (o.table_stack || []).flat().filter(Boolean);
      if (tables.length > 0) g.tableBlocks.push(tables);
    }

    return Array.from(groups.values()).map(g => {
      // Синтетический Order для отрисовки в OrderCard (и модалке, и мини-ряду).
      // quantity_stack/table_stack — уже «merged» вид, чтобы карточка не
      // показывала «1+1+1» и красную стрелку Merge.
      const virtualOrder: Order = {
        id: g.virtualId,
        dish_id: g.dishId,
        quantity_stack: [g.totalQuantity],
        table_stack: g.tableBlocks.length > 0 ? [g.tableBlocks.flat()] : [[]],
        created_at: g.earliestCreatedAt,
        updated_at: Date.now(),
        status: 'ACTIVE',
        accumulated_time_ms: g.accumulatedTimeMs,
        defrost_started_at: g.startedAt,
        defrost_duration_seconds: g.durationSec,
      };
      return { ...g, virtualOrder };
    });
  }, [orders, now]);

  // Маппинг virtualId → sourceOrderIds для разморозочных действий.
  // Строим inline из defrostingGroups — пересобираем при каждом изменении.
  const defrostGroupMapping = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of defrostingGroups) m.set(g.virtualId, g.sourceOrderIds);
    return m;
  }, [defrostingGroups]);

  // State: id группы разморозки, открытой в DefrostModal (null = закрыта).
  const [defrostModalGroupId, setDefrostModalGroupId] = useState<string | null>(null);
  const defrostModalGroup = useMemo(
    () => defrostingGroups.find(g => g.virtualId === defrostModalGroupId) ?? null,
    [defrostingGroups, defrostModalGroupId]
  );
  // Если таймер истёк (и группа исчезла), а модалка ещё открыта — закрываем её.
  useEffect(() => {
    if (defrostModalGroupId && !defrostModalGroup) {
      setDefrostModalGroupId(null);
    }
  }, [defrostModalGroupId, defrostModalGroup]);

  /**
   * Резолв id карточки, на которой кликнули ❄️, в набор реальных
   * order_item_id. Для Smart Wave виртуального id берём из smartQueueMappingRef,
   * для стандартного режима — сам id единственный item.
   */
  const resolveSourceOrderIds = useCallback((cardId: string): string[] => {
    const mapping = smartQueueMappingRef.current.get(cardId);
    if (mapping) {
      return Array.from(mapping.itemCountByOrder.keys());
    }
    return [cardId];
  }, []);

  const sortedOrders = useMemo(() => {
    const isSmartAggregation = settings?.enableSmartAggregation === true;

    // ====================================================================
    // SMART AGGREGATION: Волновая симуляция очереди
    // ====================================================================
    if (isSmartAggregation) {
      const courseWindowMs = (settings?.courseWindowSeconds || 300) * 1000;
      const smartQueue = buildSmartQueue(activeOrders, dishes, categories, courseWindowMs);

      // Обновляем маппинг виртуальных ID → реальные source orders
      const newMapping = new Map<string, { sourceOrderIds: string[], itemCountByOrder: Map<string, number> }>();

      // Конвертируем SmartQueueGroup[] → виртуальные Order[] для совместимости с OrderCard
      const virtualOrders: Order[] = smartQueue.map((group) => {
        // Стабильный virtual ID: основан на dishId + sourceOrderIds (не position!)
        // Это предотвращает потерю merge-состояния при сдвиге позиций
        const stableKey = group.sourceOrderIds.sort().join('_');
        const virtualId = `smart_${group.dishId}_${stableKey}`;

        // Считаем сколько порций каждого реального заказа в этой группе
        const itemCountByOrder = new Map<string, number>();
        for (const item of group.items) {
          itemCountByOrder.set(item.orderId, (itemCountByOrder.get(item.orderId) || 0) + 1);
        }

        newMapping.set(virtualId, {
          sourceOrderIds: group.sourceOrderIds,
          itemCountByOrder,
        });

        // Создаём виртуальный Order-объект (совместимый с OrderCard)
        // Сохраняем структуру стека: каждый source order = отдельный блок
        // Это даёт OrderCard'у показать "1 + 1", красную стрелку и "ЕЩЁ ЗАКАЗ"
        let quantityStack: number[] = [];
        let tableStack: number[][] = [];

        for (const sourceId of group.sourceOrderIds) {
          const count = itemCountByOrder.get(sourceId) || 0;
          const sourceOrder = activeOrders.find(o => o.id === sourceId);
          const sourceTables = sourceOrder
            ? (sourceOrder.table_stack?.flat() || [sourceOrder.tableNumber || 0]).filter(Boolean)
            : [];
          quantityStack.push(count);
          tableStack.push(sourceTables.length > 0 ? sourceTables : [0]);
        }

        // Если пользователь нажал merge — объединяем стек в один блок
        if (mergedVirtualIds.has(virtualId)) {
          const totalQty = quantityStack.reduce((a, b) => a + b, 0);
          const allTables = tableStack.flat();
          quantityStack = [totalQty];
          tableStack = [allTables];
        }

        // Если группа состоит из уже размороженных source-ов — пробрасываем
        // defrost-метаданные с одного из них в virtualOrder. Это нужно чтобы
        // OrderCard увидел hasDefrostBeenStarted(order)=true и (а) отрисовал
        // серую ❄️-индикацию «уже размораживалось», (б) СКРЫЛ синюю кнопку
        // запуска. Без этого клик ❄️ на агрегированной карточке перезапускал
        // разморозку на уже готовой рыбе — см. комментарий к группировке
        // по (dishId + wasDefrosted) в smartQueue.groupItemsByDish.
        //
        // Группировка гарантирует, что все source-ы в группе имеют одинаковый
        // defrost-статус, поэтому значения из первого source-а корректны
        // для всей группы.
        let defrostStartedAt: number | null = null;
        let defrostDurationSeconds: number | null = null;
        if (group.wasDefrosted) {
          const src = activeOrders.find(
            o => group.sourceOrderIds.includes(o.id) && o.defrost_started_at != null
          );
          if (src) {
            defrostStartedAt = src.defrost_started_at ?? null;
            defrostDurationSeconds = src.defrost_duration_seconds ?? null;
          }
        }

        const virtualOrder: Order = {
          id: virtualId,
          dish_id: group.dishId,
          quantity_stack: quantityStack,
          table_stack: tableStack,
          created_at: group.earliestOrderTime,
          updated_at: Date.now(),
          status: 'ACTIVE',
          defrost_started_at: defrostStartedAt,
          defrost_duration_seconds: defrostDurationSeconds,
        };

        return virtualOrder;
      });

      smartQueueMappingRef.current = newMapping;
      return virtualOrders;
    }

    // ====================================================================
    // СТАНДАРТНАЯ СОРТИРОВКА (Smart Aggregation выключена)
    // ====================================================================
    smartQueueMappingRef.current = new Map(); // Очистить маппинг

    const rules = settings?.activePriorityRules || ['ULTRA', 'COURSE_FIFO'];
    const courseWindowMs = (settings?.courseWindowSeconds || 300) * 1000;

    const getBestCategoryIndex = (d: Dish) => {
      if (!d.category_ids || d.category_ids.length === 0) return 999;
      const indices = d.category_ids
        .map(id => categories.find(c => c.id === id)?.sort_index)
        .filter((idx): idx is number => idx !== undefined);
      return indices.length > 0 ? Math.min(...indices) : 999;
    };

    // Фильтруем активно размораживающиеся — они отображаются мини-карточкой
    // в DefrostRow и не должны дублироваться в основной очереди (симметрично
    // поведению Smart Wave, где фильтр стоит внутри `smartQueue.flattenOrders`).
    return [...activeOrders].filter(o => !isDefrostActive(o, now)).sort((a, b) => {
      const dishA = dishes.find(d => d.id === a.dish_id);
      const dishB = dishes.find(d => d.id === b.dish_id);

      if (!dishA || !dishB) return 0;

      for (const rule of rules) {
        if (rule === 'ULTRA') {
          // ULTRA лишается приоритета после разморозки — такой же контракт
          // как в Smart Wave (smartQueue.buildSmartQueue ULTRA-split).
          // Бизнес-требование: после истечения таймера карточка возвращается
          // в очередь БЕЗ ULTRA-обгона.
          const isUltraA = dishA.priority_flag === PriorityLevel.ULTRA && !hasDefrostBeenStarted(a);
          const isUltraB = dishB.priority_flag === PriorityLevel.ULTRA && !hasDefrostBeenStarted(b);
          if (isUltraA && !isUltraB) return -1;
          if (!isUltraA && isUltraB) return 1;
          if (isUltraA && isUltraB) return a.created_at - b.created_at;
        }

        if (rule === 'FIFO') {
          if (a.created_at !== b.created_at) return a.created_at - b.created_at;
        }

        if (rule === 'COURSE_FIFO') {
          const bucketA = Math.floor(a.created_at / courseWindowMs);
          const bucketB = Math.floor(b.created_at / courseWindowMs);
          if (bucketA !== bucketB) return bucketA - bucketB;

          const indexA = getBestCategoryIndex(dishA);
          const indexB = getBestCategoryIndex(dishB);
          if (indexA !== indexB) return indexA - indexB;

          return a.created_at - b.created_at;
        }

        if (rule === 'CATEGORY') {
          const indexA = getBestCategoryIndex(dishA);
          const indexB = getBestCategoryIndex(dishB);
          if (indexA !== indexB) return indexA - indexB;
          return a.created_at - b.created_at;
        }
      }

      return a.created_at - b.created_at;
    });
  }, [activeOrders, dishes, categories, settings, mergedVirtualIds]);

  const checkStopped = (dish: Dish): string | null => {
    // Board ONLY checks Dish status - ingredient logic is synced at App level
    if (dish.is_stopped) {
      return dish.stop_reason || 'Dish Unavailable';
    }
    return null;
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Modal State Inputs
  const [parkTableInput, setParkTableInput] = useState('');
  const [parkTimeInput, setParkTimeInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleParkSubmit = () => {
    const tableNum = parseInt(parkTableInput);
    if (isNaN(tableNum)) {
      setErrorMsg('Неверный номер стола');
      return;
    }

    if (!parkTimeInput) {
      setErrorMsg('Укажите время');
      return;
    }

    const [hours, minutes] = parkTimeInput.split(':').map(Number);
    const now = new Date();
    const returnDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);

    // If time is earlier than now, assume it's for tomorrow? Or forbid?
    // Requirement: "Нельзя указать время возврата, которое уже прошло"
    if (returnDate.getTime() < now.getTime()) {
      // Check if maybe user meant tomorrow (e.g. now 23:00, input 01:00)
      // But simplifying: just forbid past time
      setErrorMsg('Время возврата не может быть в прошлом');
      return;
    }

    onParkTable(tableNum, returnDate.getTime());
    setShowParkModal(false);
    setParkTableInput('');
    setParkTimeInput('');
    setErrorMsg('');
  };

  // State for partial completion modal
  const [partialOrder, setPartialOrder] = useState<Order | null>(null);

  return (
    <div className="p-6 overflow-y-auto h-full flex flex-col relative">
      {partialOrder && onPartialComplete && (
        <PartialCompletionModal
          totalQty={partialOrder.quantity_stack.reduce((a, b) => a + b, 0)}
          onConfirm={(qty) => {
            // Smart Aggregation: распределить PartDone по реальным source orders
            const mapping = smartQueueMappingRef.current.get(partialOrder.id);
            if (mapping) {
              let remainingToComplete = qty;
              // Проходим по source orders в порядке FIFO
              for (const [sourceId, maxCount] of mapping.itemCountByOrder) {
                if (remainingToComplete <= 0) break;
                const sourceOrder = orders.find(o => o.id === sourceId);
                if (!sourceOrder) continue;
                const sourceTotalQty = sourceOrder.quantity_stack.reduce((a, b) => a + b, 0);
                const toComplete = Math.min(remainingToComplete, maxCount);
                if (toComplete >= sourceTotalQty) {
                  onCompleteOrder(sourceId);
                } else {
                  onPartialComplete(sourceId, toComplete);
                }
                remainingToComplete -= toComplete;
              }
            } else {
              // Стандартный режим
              onPartialComplete(partialOrder.id, qty);
            }
            setPartialOrder(null);
          }}
          onClose={() => setPartialOrder(null)}
        />
      )}
      {/* Top Control Panel */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Layers className="text-blue-500" /> KDS Board
        </h1>
        <div className="flex gap-4">
          <button
            onClick={() => setShowHistoryModal(true)}
            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded flex items-center gap-2 border border-slate-600 transition-all font-bold"
          >
            <History size={18} className="text-cyan-400" /> История
          </button>

          <button
            onClick={() => setShowParkModal(true)}
            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded flex items-center gap-2 border border-slate-600 transition-all font-bold"
          >
            <PauseCircle size={18} className="text-yellow-400" /> Отложить
          </button>
          <button
            onClick={() => setShowParkingList(true)}
            className={`
              px-4 py-2 rounded flex items-center gap-2 transition-all font-bold relative
              ${parkedTablesCount > 0
                ? 'bg-purple-900/40 border border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)] text-white hover:bg-purple-900/60'
                : 'bg-slate-800 border border-slate-600 text-white hover:bg-slate-700'}
            `}
          >
            <Car size={18} className={parkedTablesCount > 0 ? "text-purple-300 animate-pulse" : "text-purple-400"} /> Парковка
            {parkedTablesCount > 0 && (
              <span className="bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded-full absolute -top-2 -right-2 border border-slate-900 shadow-sm">
                {parkedTablesCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Ряд мини-карточек размораживающихся блюд (миграция 016).
          Между заголовком «KDS Board» и основной сеткой. Голубоватый фон
          визуально отделяет зону разморозки. Мини-карточки агрегированы:
          Smart Wave «вспышка» (3 стола одной рыбы) = одна мини-карточка. */}
      <DefrostRow
        orders={defrostingGroups.map(g => g.virtualOrder)}
        dishes={dishes}
        now={now}
        settings={settings}
        onOpenModal={(vid) => setDefrostModalGroupId(vid)}
        onCancelDefrost={(vid) => {
          const sourceIds = defrostGroupMapping.get(vid);
          onCancelDefrost?.(sourceIds?.[0] ?? vid, sourceIds);
        }}
        onCompleteDefrost={(vid) => {
          const sourceIds = defrostGroupMapping.get(vid);
          onCompleteDefrost?.(sourceIds?.[0] ?? vid, sourceIds);
        }}
      />

      {/* Модалка разморозки — стандартный OrderCard с кнопкой «РАЗМОРОЗИЛАСЬ».
          Синтетический virtualOrder передаётся как обычный Order; при клике
          «Разморозилась» резолвим источники и шлём defrost-complete на все. */}
      {defrostModalGroup && (
        <DefrostModal
          order={defrostModalGroup.virtualOrder}
          dish={dishes.find(d => d.id === defrostModalGroup.dishId)!}
          categories={categories}
          ingredients={ingredients}
          now={now}
          onClose={() => setDefrostModalGroupId(null)}
          onConfirmDefrosted={() => {
            const sourceIds = defrostModalGroup.sourceOrderIds;
            onCompleteDefrost?.(sourceIds[0], sourceIds);
          }}
          onCompleteOrder={() => { /* заменяется на onConfirmDefrosted внутри DefrostModal */ }}
          onStackMerge={() => { /* в разморозке merge не применяется — стек уже [total] */ }}
          onCancelOrder={(id) => {
            // «Отмена заказа» изнутри модалки — отменяет разморозку + сам заказ.
            // Достаточно отменить разморозку (юзер сам закроет модалку или
            // сделает следующее действие). Здесь пассивно пропускаем.
            onCancelOrder?.(id);
          }}
          onPreviewImage={onPreviewImage}
        />
      )}

      {/* Auto-fill grid — количество колонок определяется шириной контейнера:
          каждая карточка минимум 320px, дальше Tailwind-аналог делит остаток
          поровну. Раньше было grid-cols-1..xl:grid-cols-4 — после 1280px
          ширина колонок фиксировалась на 4, и на больших мониторах / при
          зуме-аут карточки оставались теми же 4 с пустым местом. */}
      <div
        className="grid gap-4 pb-20"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
      >
        {sortedOrders.map(order => {
          const dish = dishes.find(d => d.id === order.dish_id);
          if (!dish) return null;

          return (
            <OrderCard
              key={order.id}
              order={order}
              dish={dish}
              categories={categories}
              ingredients={ingredients}
              now={now}
              onCompleteOrder={(orderId) => {
                // Smart Aggregation: маппинг виртуального ID → реальные заказы
                const mapping = smartQueueMappingRef.current.get(orderId);
                if (mapping) {
                  for (const [sourceId, count] of mapping.itemCountByOrder) {
                    const sourceOrder = orders.find(o => o.id === sourceId);
                    if (!sourceOrder) continue;
                    const sourceTotalQty = sourceOrder.quantity_stack.reduce((a, b) => a + b, 0);
                    if (count >= sourceTotalQty) {
                      // Полное завершение этого source order
                      onCompleteOrder(sourceId);
                    } else {
                      // Частичное завершение
                      onPartialComplete?.(sourceId, count);
                    }
                  }
                } else {
                  // Стандартный режим (не Smart Aggregation)
                  onCompleteOrder(orderId);
                }
              }}
              onPartialComplete={(id) => {
                // Smart Aggregation: PartDone на виртуальном заказе
                const mapping = smartQueueMappingRef.current.get(id);
                if (mapping) {
                  // Создаём виртуальный Order для модалки PartialCompletion
                  const virtualOrder = sortedOrders.find(o => o.id === id);
                  if (virtualOrder) setPartialOrder(virtualOrder);
                } else {
                  const o = orders.find(x => x.id === id);
                  if (o) setPartialOrder(o);
                }
              }}
              onStackMerge={(id) => {
                // Smart Aggregation: merge на виртуальном заказе
                const mapping = smartQueueMappingRef.current.get(id);
                if (mapping) {
                  // Добавляем в set merged — виртуальный заказ перестроится с объединённым стеком
                  setMergedVirtualIds(prev => {
                    const next = new Set(prev);
                    next.add(id);
                    return next;
                  });
                } else {
                  onStackMerge(id);
                }
              }}
              onCancelOrder={onCancelOrder}
              onPreviewImage={onPreviewImage}
              isInWork={inWorkIds.has(order.id)}
              onToggleInWork={toggleInWork}
              // ❄️ Запуск разморозки — резолвим Smart Wave virtual id в реальные
              // source_order_ids (через smartQueueMappingRef). Для стандартного
              // режима sourceIds = [order.id].
              onStartDefrost={(id) => {
                const sourceIds = resolveSourceOrderIds(id);
                onStartDefrost?.(sourceIds[0], sourceIds);
              }}
            />
          );
        })}

        {/* Empty State */}
        {sortedOrders.length === 0 && (
          <div className="col-span-full h-96 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-lg">
            <div className="bg-slate-800/50 p-6 rounded-full mb-4">
              <Check size={48} className="text-slate-500" />
            </div>
            <h3 className="text-xl font-bold mb-2">Все заказы готовы</h3>
            <p>Нет новых заказов.</p>
          </div>
        )}
      </div>

      {/* Park Modal */}
      {showParkModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-2">
          <div className="bg-kds-card rounded-lg w-[900px] max-w-full max-h-[calc(100vh-16px)] flex flex-col border border-slate-700 shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-white flex items-center">
                <PauseCircle className="mr-2 text-yellow-400" size={20} /> Отложить заказ
              </h3>
              <button onClick={() => setShowParkModal(false)}><X className="text-slate-500 hover:text-white" size={20} /></button>
            </div>

            <div className="flex-1 min-h-0 flex p-4 gap-4">
              {/* Left Column: Table Number (Numpad) */}
              <div className="flex-1 flex flex-col">
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Номер стола</label>
                <div className="bg-slate-900 border border-slate-700 rounded p-2 mb-2 text-center">
                  <span className={`text-2xl font-mono font-bold ${parkTableInput ? 'text-white' : 'text-slate-600'}`}>
                    {parkTableInput || '0'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 flex-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                      key={num}
                      onClick={() => setParkTableInput(prev => prev + num)}
                      className="bg-slate-800 hover:bg-slate-700 text-white text-xl font-bold rounded p-2 transition-colors border border-slate-700"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={() => setParkTableInput('')}
                    className="bg-slate-800 hover:bg-red-900/30 text-red-400 font-bold rounded p-2 transition-colors border border-slate-700"
                  >
                    C
                  </button>
                  <button
                    onClick={() => setParkTableInput(prev => prev + '0')}
                    className="bg-slate-800 hover:bg-slate-700 text-white text-xl font-bold rounded p-2 transition-colors border border-slate-700"
                  >
                    0
                  </button>
                  <button
                    onClick={() => setParkTableInput(prev => prev.slice(0, -1))}
                    className="bg-slate-800 hover:bg-slate-700 text-white font-bold rounded p-2 transition-colors border border-slate-700 flex items-center justify-center"
                  >
                    ⌫
                  </button>
                </div>
              </div>

              {/* Right Column: Time Selection (Slots) */}
              <div className="flex-1 flex flex-col min-h-0">
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Время возврата</label>
                <div className="bg-slate-900 border border-slate-700 rounded p-2 mb-2 text-center">
                  <span className={`text-2xl font-mono font-bold ${parkTimeInput ? 'text-blue-400' : 'text-slate-600'}`}>
                    {parkTimeInput || '--:--'}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto grid grid-cols-4 gap-1.5 pr-1 content-start">
                  {(() => {
                    const slots = [];
                    const now = new Date();
                    const nowTotalMinutes = now.getHours() * 60 + now.getMinutes();

                    // Requirements: 12:00 to 23:30
                    const startHour = 12;
                    const startMin = 0;
                    const endHour = 23;
                    const endMin = 30;

                    let currentHour = startHour;
                    let currentMin = startMin;

                    while (currentHour < endHour || (currentHour === endHour && currentMin <= endMin)) {
                      const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;

                      // Check if time is in the past TODAY
                      const slotTotalMinutes = currentHour * 60 + currentMin;
                      const isPast = slotTotalMinutes < nowTotalMinutes;

                      slots.push({ time: timeStr, isPast });

                      currentMin += 15;
                      if (currentMin >= 60) {
                        currentMin = 0;
                        currentHour++;
                      }
                    }

                    return slots.map(({ time, isPast }) => (
                      <button
                        key={time}
                        onClick={() => !isPast && setParkTimeInput(time)}
                        disabled={isPast}
                        className={`
                          py-1.5 rounded text-sm font-mono font-bold border transition-all
                          ${parkTimeInput === time
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                            : isPast
                              ? 'bg-slate-900 border-slate-800 text-slate-700 cursor-not-allowed opacity-50'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'}
                        `}
                      >
                        {time}
                      </button>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="mx-4 mb-2 bg-red-500/10 border border-red-500/50 text-red-500 p-2 rounded text-sm flex items-center shrink-0">
                <AlertTriangle size={14} className="mr-2" /> {errorMsg}
              </div>
            )}

            <div className="p-4 border-t border-slate-800 flex gap-3 bg-slate-900/50 shrink-0">
              <button
                onClick={() => setShowParkModal(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-bold transition-colors uppercase tracking-wider text-sm"
              >
                Отмена
              </button>
              <button
                onClick={handleParkSubmit}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-blue-900/20 uppercase tracking-wider text-sm"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parking List Panel */}
      {showParkingList && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-kds-card p-6 rounded-lg w-[600px] max-h-[80vh] flex flex-col border border-slate-700 shadow-2xl">
            <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
              <h3 className="text-xl font-bold text-white flex items-center">
                <Car className="mr-2 text-blue-400" /> Парковка
                <span className="ml-3 text-sm bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                  {parkedTablesCount} столов
                </span>
              </h3>
              <button
                onClick={() => setShowParkingList(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {orders.filter(o => o.status === 'PARKED').length === 0 ? (
                <div className="text-center py-20 text-slate-500 italic flex flex-col items-center">
                  <Car size={48} className="mb-4 opacity-20" />
                  Нет отложенных заказов
                </div>
              ) : (
                // Group by Table (simplified for display)
                Array.from(new Set(orders
                  .filter(o => o.status === 'PARKED')
                  .flatMap(o => o.table_stack ? o.table_stack.flat() : (o.table_numbers || []))
                )).map(tableNum => {
                  const tableOrders = orders.filter(o =>
                    o.status === 'PARKED' &&
                    (o.table_stack ? o.table_stack.flat().includes(tableNum) : (o.table_numbers?.includes(tableNum)))
                  );
                  if (tableOrders.length === 0) return null;

                  // Форматтер времени возврата. Используется и для заголовка
                  // стола, и для мини-подписи возле каждой позиции.
                  const fmt = (ms?: number) => {
                    if (!ms) return '—';
                    const d = new Date(ms);
                    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                  };

                  // Если у разных позиций стола разные unpark_at (например
                  // ручная парковка супа + авто-парковка десерта на одном столе),
                  // показываем диапазон «12:30–12:40», а не одно фейковое время.
                  // Точное время каждой позиции рисуется возле неё ниже.
                  const unparkTimes = tableOrders
                    .map((o: Order) => o.unpark_at)
                    .filter((t: number | undefined): t is number => !!t);
                  const minUnpark = unparkTimes.length > 0 ? Math.min(...unparkTimes) : 0;
                  const maxUnpark = unparkTimes.length > 0 ? Math.max(...unparkTimes) : 0;
                  const hasMixedTimes = minUnpark !== maxUnpark;
                  const headerTime = hasMixedTimes
                    ? `${fmt(minUnpark)}–${fmt(maxUnpark)}`
                    : fmt(minUnpark);

                  // Group by Table -> Then by Category
                  const dishesByCat = tableOrders.reduce((acc, order) => {
                    const dish = dishes.find(d => d.id === order.dish_id);
                    // Use first category or "Uncategorized"
                    const catId = dish?.category_ids?.[0] || 'uncategorized';
                    if (!acc[catId]) acc[catId] = [];
                    acc[catId].push(order);
                    return acc;
                  }, {} as Record<string, Order[]>);

                  return (
                    <div key={tableNum} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="text-yellow-400 font-bold text-lg mb-1">Стол №{tableNum}</div>
                          <div className="text-slate-400 text-xs flex items-center">
                            <CalendarClock size={14} className="mr-1" />
                            Возврат {hasMixedTimes ? '' : 'в '}
                            <span className="text-white font-mono ml-1 font-bold">{headerTime}</span>
                            {hasMixedTimes && (
                              <span className="text-slate-500 ml-1 italic">(разное время)</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => onUnparkTable(tableNum)}
                          className="bg-green-600 hover:bg-green-500 text-white text-xs px-3 py-2 rounded font-bold transition-colors flex items-center"
                        >
                          <Check size={14} className="mr-1" /> Вернуть всё
                        </button>
                      </div>

                      <div className="space-y-4 pl-4 border-l-2 border-slate-700">
                        {Object.entries(dishesByCat).map(([catId, catOrders]: [string, Order[]]) => {
                          const catName = categories.find(c => c.id === catId)?.name || 'Other';

                          return (
                            <div key={catId} className="space-y-2">
                              {/* Category Header */}
                              <div className="flex justify-between items-center bg-slate-800/50 px-2 py-1 rounded">
                                <span className="text-blue-400 font-bold text-xs uppercase tracking-wider">{catName}</span>
                                <button
                                  onClick={() => onUnparkOrders?.(catOrders.map(o => o.id))}
                                  className="text-xs text-green-100/90 hover:text-white bg-green-900/40 hover:bg-green-700/60 flex items-center gap-1 px-2 py-1 rounded font-bold transition-colors border border-green-800/50 shadow-sm"
                                >
                                  <Layers size={12} /> Вернуть группу
                                </button>
                              </div>

                              {/* Items */}
                              {catOrders.map(order => {
                                const dish = dishes.find(d => d.id === order.dish_id);
                                const totalQty = order.quantity_stack.reduce((a, b) => a + b, 0);
                                // Время возврата ЭТОЙ позиции. Показываем только
                                // если на столе смешанные времена — иначе дублирует
                                // заголовок стола и засоряет UI.
                                const itemReturnTime = hasMixedTimes ? fmt(order.unpark_at) : null;
                                return (
                                  <div key={order.id} className="text-sm text-slate-300 flex justify-between items-center pl-2">
                                    <div className="flex items-center gap-2">
                                      {/* Individual Unpark Button */}
                                      <button
                                        onClick={() => onUnparkOrders?.([order.id])}
                                        title="Вернуть только это блюдо"
                                        className="text-[10px] text-green-100/80 hover:text-white bg-green-900/30 hover:bg-green-700/50 border border-green-800/50 px-2 py-0.5 rounded transition-colors flex items-center"
                                      >
                                        <Check size={10} className="mr-1" />
                                        Вернуть
                                      </button>
                                      <span>{dish?.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      {itemReturnTime && (
                                        <span className="text-[10px] font-mono text-cyan-400/80 bg-cyan-900/20 px-1.5 py-0.5 rounded border border-cyan-800/40">
                                          {itemReturnTime}
                                        </span>
                                      )}
                                      <span className="font-mono text-slate-500">x{totalQty}</span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );

                })
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowParkingList(false)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2 rounded font-bold transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-kds-card w-[800px] h-[80vh] rounded-lg border border-slate-700 shadow-2xl flex flex-col">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <History className="text-purple-400" /> История заказов (последние {settings?.historyRetentionMinutes ?? 60} мин)
              </h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {orderHistory.filter(h => Date.now() - h.completedAt < (settings?.historyRetentionMinutes ?? 60) * 60 * 1000).length === 0 ? (
                <div className="text-center text-slate-500 py-10">Нет выполненных заказов за последние {settings?.historyRetentionMinutes ?? 60} минут</div>
              ) : (
                orderHistory
                  .filter(h => Date.now() - h.completedAt < (settings?.historyRetentionMinutes ?? 60) * 60 * 1000)
                  .sort((a, b) => b.completedAt - a.completedAt)
                  .map(entry => (
                    <div key={entry.id} className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex justify-between items-center">
                      <div>
                        <h4 className="text-lg font-bold text-white mb-1">{entry.dishName}</h4>
                        {/* Render Tables using Snapshot Data for precise visuals */}
                        {entry.snapshot && entry.snapshot.table_stack && (
                          <div className="flex flex-wrap gap-1 items-center mt-2">
                            <span className="text-xs text-slate-500 mr-1">СТОЛЫ:</span>
                            {entry.snapshot.table_stack.map((tables, bIdx) => (
                              <React.Fragment key={bIdx}>
                                {bIdx > 0 && <span className="text-slate-500 mx-0.5">+</span>}
                                {tables.map((t, tIdx) => {
                                  const isParked = entry.snapshot.parked_tables
                                    ? entry.snapshot.parked_tables.includes(t)
                                    : !!entry.snapshot.was_parked;

                                  return (
                                    <React.Fragment key={tIdx}>
                                      {tIdx > 0 && <span className="text-slate-500 mr-1">,</span>}
                                      {isParked ? (
                                        <span className="text-purple-300 bg-purple-900/40 px-1.5 py-0.5 rounded border border-purple-500/50 text-xs">
                                          {t}
                                        </span>
                                      ) : (
                                        <span className="text-yellow-400 font-bold text-xs">
                                          {t}
                                        </span>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-slate-400 mt-2 flex gap-4">
                          <span>Завершен: {new Date(entry.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>Время готовки: {formatTime(entry.prepTimeMs)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (onRestoreOrder) onRestoreOrder(entry.id);
                          setShowHistoryModal(false);
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-600 px-4 py-2 rounded font-bold flex items-center gap-2 transition-colors"
                      >
                        <History size={16} /> Вернуть
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};