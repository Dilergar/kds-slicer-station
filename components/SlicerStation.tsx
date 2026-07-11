/**
 * SlicerStation.tsx — Основная KDS-доска (Kitchen Display System)
 *
 * Главный экран нарезчика: карточки заказов, парковка, история.
 *
 * Режимы очереди:
 * 1. Smart Wave Aggregation — «Волновая (Умная)» (ON по умолчанию):
 *    - Вызывает buildSmartQueue() из smartQueue.ts
 *    - SmartQueueGroup[] → виртуальные Order[] для OrderCard
 *    - Virtual ID: база `smart_${dishId}_${wasDefrosted}` + порядковый суффикс
 *      для повторных позиций того же блюда (одно блюдо может законно занять
 *      2+ места в очереди — id обязаны быть уникальными)
 *    - Stack-структура сохраняется (каждый source = блок) → показывает "1+1"
 *    - Merge виртуальной карточки = merge_ack=TRUE у source-заказов в БД
 *      (миграция 022), переживает F5 и синхронен между планшетами
 *    - Done/PartDone/Merge резолвятся через smartQueueMappingRef
 *
 * 2. «Окно Агрегации» — режим скорости (enableAggregation, реализован
 *    2026-07-06): buildSpeedQueue() — без порядка категорий, безлимитное
 *    слияние одинаковых блюд, строгий FIFO по первому заказу. Пайплайн
 *    виртуальных карточек тот же, что у умной.
 *
 * 3. Стандартная сортировка (оба режима OFF):
 *    - ULTRA → COURSE_FIFO по sort_index категории → FIFO по created_at,
 *      каждая позиция чека — отдельная карточка
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dish, Order, Category, IngredientBase, PriorityLevel, OrderHistoryEntry, SystemSettings, SmartQueueGroup } from '../types';
import { Clock, Flame, Check, Layers, AlertTriangle, PauseCircle, Car, X, CalendarClock, History, Undo, ArrowLeft, MoveLeft, ArrowUp, PieChart } from 'lucide-react';
import { PartialCompletionModal } from './PartialCompletionModal';
import { OrderCard } from './OrderCard';
import { DefrostRow } from './DefrostRow';
import { DefrostModal } from './DefrostModal';
import { buildSmartQueue, buildSpeedQueue, isDefrostActive, PersistentVtEntry } from '../smartQueue';
import { playDefrostBeep, playNewOrderBeep } from '../utils';

interface SlicerStationProps {
  orders: Order[];
  dishes: Dish[];
  categories: Category[];
  ingredients: IngredientBase[];
  onCompleteOrder: (orderId: string) => void;
  onStackMerge: (orderId: string) => void;
  /**
   * Merge виртуальной карточки Smart Wave (миграция 022): проставить
   * merge_ack=TRUE всем реальным source-заказам карточки. Персистится в БД —
   * переживает F5/переключение вкладок, синхронно между планшетами.
   */
  onMergeAck?: (sourceOrderIds: string[]) => void;
  onPreviewImage: (url: string) => void;
  onParkTable: (tableNumber: number, returnTimestamp: number) => void;
  onUnparkTable: (tableNumber: number) => void;
  onUnparkOrders?: (orderIds: string[]) => void;
  onCancelOrder?: (orderId: string) => void;
  onPartialComplete?: (orderId: string, quantity: number) => void;
  orderHistory?: OrderHistoryEntry[];
  onRestoreOrder?: (id: string) => void;
  settings?: SystemSettings;
  /**
   * true, пока useOrders не получил первый ответ GET /api/orders. Нужен звуку
   * нового заказа (миграция 026): первый реальный снапшот доски запоминается
   * молча, иначе каждый F5 «звенел» бы всеми текущими заказами.
   */
  ordersLoading?: boolean;
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
  onMergeAck,
  onPreviewImage,
  onParkTable,
  onUnparkTable,
  onUnparkOrders,
  onPartialComplete,
  onCancelOrder,
  orderHistory = [],
  onRestoreOrder,
  settings,
  ordersLoading,
  onStartDefrost,
  onCancelDefrost,
  onCompleteDefrost
}) => {
  const retentionMinutes = settings?.historyRetentionMinutes || 60;
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

  // === «В работе» — локальный визуальный claim карточки ===
  // Чисто UI-состояние для координации двух нарезчиков за одним планшетом:
  // тап по карточке → неоновая рамка + 🔪 у количества порции. Повторный
  // тап снимает. Не пишется в БД, не переживает F5, не участвует в отчётах —
  // только сигнал «эту уже кто-то взял, не трогай».
  const [inWorkIds, setInWorkIds] = useState<Set<string>>(new Set());

  /**
   * Якорный id карточки для клейма «В работе». Виртуальный id нестабилен:
   * его порядковый суффикс (`_1`, `_2`) пересчитывается позиционно на каждой
   * ежесекундной пересборке, и при перестановке двух карточек одного блюда
   * метка 🔪 перепрыгивала на чужую карточку (ревью 2026-07-11). Поэтому
   * клейм ключуем по ПЕРВОМУ source-заказу карточки — он фиксируется в момент
   * её создания и не меняется, пока карточка живёт. В стандартном режиме
   * (без маппинга) id уже реальный — он и есть якорь.
   */
  const claimAnchorOf = useCallback((cardId: string): string => {
    const mapping = smartQueueMappingRef.current.get(cardId);
    return mapping?.sourceOrderIds[0] ?? cardId;
  }, []);

  const toggleInWork = useCallback((cardId: string) => {
    const anchor = claimAnchorOf(cardId);
    setInWorkIds(prev => {
      const next = new Set(prev);
      if (next.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
  }, [claimAnchorOf]);

  // === Звук готовности разморозки ===
  // Трекинг переходов «таймер идёт → таймер истёк» по СЫРЫМ заказам.
  // Ключ = `${order.id}_${defrost_started_at}`: перезапуск разморозки даёт
  // новый ключ, значение — последнее увиденное состояние таймера.
  //
  // Beep играет ТОЛЬКО на живом переходе active→expired. Ключ, впервые
  // увиденный уже истёкшим, не звучит — это отсекает ложные сигналы при
  // F5 (старые размороженные позиции) и при ручном «Разморозилась»
  // (бэкдейт started_at сразу создаёт «истёкший» ключ).
  //
  // Раньше звук жил в DefrostRow и не срабатывал никогда: туда попадали
  // только АКТИВНЫЕ группы, истёкшая исчезала из списка тем же тиком.
  const defrostSoundStateRef = useRef<Map<string, 'active' | 'expired'>>(new Map());

  useEffect(() => {
    const enabled = settings?.enableDefrostSound !== false;
    const seen = defrostSoundStateRef.current;
    const currentKeys = new Set<string>();
    // Считаем переходы active→expired за ЭТОТ тик, а звук играем ОДИН раз
    // после цикла. Smart Wave «вспышка» (клик ❄️ на объединённой карточке =
    // N реальных позиций с одним started_at) истекает вся разом — раньше
    // playDefrostBeep вызывался N раз внахлёст, создавая N AudioContext
    // (тройной/искажённый сигнал, ревью 2026-07-11).
    let expiredTransitions = 0;

    for (const o of orders) {
      if (o.defrost_started_at == null) continue;
      const key = `${o.id}_${o.defrost_started_at}`;
      currentKeys.add(key);

      const endsAt = o.defrost_started_at + (o.defrost_duration_seconds ?? 0) * 1000;
      const state: 'active' | 'expired' = now >= endsAt ? 'expired' : 'active';

      if (seen.get(key) === 'active' && state === 'expired') {
        expiredTransitions++;
      }
      seen.set(key, state);
    }

    if (expiredTransitions > 0 && enabled) {
      playDefrostBeep();
    }

    // Чистим ключи исчезнувших позиций (завершены/отменены/паркованы) —
    // иначе Map растёт бесконечно за смену.
    for (const key of Array.from(seen.keys())) {
      if (!currentKeys.has(key)) seen.delete(key);
    }
  }, [orders, now, settings?.enableDefrostSound]);

  // === Звук поступления нового заказа (миграция 026) ===
  // Множество всех id заказов, виденных за жизнь компонента. Появление id,
  // которого в множестве нет, = новый заказ → двойной beep. Правила:
  //  - null = первый успешный снапшот ещё не наблюдали. Пока ordersLoading —
  //    ждём; первый реальный снапшот запоминаем МОЛЧА, иначе F5/переключение
  //    вкладок «звенело» бы всеми заказами, уже висящими на доске.
  //  - Множество НЕ чистится при исчезновении заказа: «Готово → Вернуть»
  //    (restore) возвращает тот же id, повторный сигнал не нужен. Размер за
  //    смену — сотни строк, умирает вместе с размонтированием компонента.
  //  - Следим за СЫРЫМИ orders (не виртуальными карточками): id реальных
  //    позиций стабильны, и звук не зависит от режима очереди. Авто-паркованный
  //    десерт тоже звучит — это поступивший заказ, просто он сразу в парковке.
  const knownOrderIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (ordersLoading) return;

    const known = knownOrderIdsRef.current;
    if (known === null) {
      knownOrderIdsRef.current = new Set(orders.map(o => o.id));
      return;
    }

    let newOrders = 0;
    for (const o of orders) {
      if (!known.has(o.id)) {
        known.add(o.id);
        newOrders++;
      }
    }
    // Один beep на тик поллинга, сколько бы позиций ни пришло разом (чек на
    // 5 блюд = 5 новых id): N перекрывающихся AudioContext дают искажённый
    // звук — тот же урок, что у звука разморозки (ревью 2026-07-11).
    if (newOrders > 0 && settings?.enableNewOrderSound !== false) {
      playNewOrderBeep();
    }
  }, [orders, ordersLoading, settings?.enableNewOrderSound]);

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

  // Липкий кэш виртуального времени позиций между пересборками очереди
  // (см. параметр persistentVt в buildSmartQueue): vt по дизайну неизменен
  // всю жизнь позиции, кэш переживает оптимистичные удаления «Готово»
  // (окно до следующего polling ~4 сек) и правки категорий посреди смены —
  // карточки не прыгают. Чистится внутри buildSmartQueue по живым заказам.
  const vtStickyCacheRef = useRef<Map<string, PersistentVtEntry>>(new Map());

  const sortedOrders = useMemo(() => {
    const isSmartAggregation = settings?.enableSmartAggregation === true;
    // «Окно Агрегации» = режим скорости (реализован 2026-07-06): очередь без
    // порядка категорий, безлимитное слияние одинаковых блюд, строгий FIFO по
    // первому заказу. Активен только когда умная выключена — тумблеры
    // взаимоисключающие (SystemSettingsTab).
    const isSpeedAggregation = !isSmartAggregation && settings?.enableAggregation === true;

    // ====================================================================
    // АГРЕГИРОВАННЫЕ РЕЖИМЫ: умная (волновая) ИЛИ скоростная очередь.
    // Оба движка возвращают SmartQueueGroup[] → дальше единый пайплайн
    // виртуальных карточек: merge_ack-стеки, маппинг «Готово» по source-ам,
    // разморозка — всё работает одинаково в обоих режимах.
    // ====================================================================
    if (isSmartAggregation || isSpeedAggregation) {
      // Шаг курса умной очереди v2 («Темп курсов», миграции 023/024) —
      // окно уступки поздних курсов новым гостям. Фолбэк = дефолту БД (600).
      const coursePaceMs = (settings?.coursePaceSeconds || 600) * 1000;
      // `now` передаём явно: очередь пересобирается каждую секунду (см. deps),
      // поэтому позиция с истёкшим таймером разморозки возвращается в сетку
      // сразу, а не со следующим polling через ~4 сек (раньше блюдо на эти
      // секунды пропадало с доски целиком: из DefrostRow уже ушло, в сетке
      // ещё не появилось).
      const smartQueue = isSmartAggregation
        ? buildSmartQueue(activeOrders, dishes, categories, coursePaceMs, now, vtStickyCacheRef.current)
        : buildSpeedQueue(activeOrders, dishes, categories, now);

      // Обновляем маппинг виртуальных ID → реальные source orders
      const newMapping = new Map<string, { sourceOrderIds: string[], itemCountByOrder: Map<string, number> }>();

      // Счётчик повторов ключа `dishId + wasDefrosted` в текущей очереди.
      // Одно блюдо может ЗАКОННО образовать 2+ позиции (пример: стол A заказал
      // рыбу; стол B позже заказал суп + рыбу → рыба B идёт отдельной позицией
      // после супа B, не вклиниваясь). Раньше обе позиции получали ОДИН
      // virtualId: маппинг перезаписывался, «Готово» на первой карточке
      // закрывало source-ы второй (чужой стол), дублировались React key.
      const seenVirtualKeys = new Map<string, number>();

      // Конвертируем SmartQueueGroup[] → виртуальные Order[] для совместимости с OrderCard
      const virtualOrders: Order[] = smartQueue.map((group) => {
        // База ID стабильна по `dishId + wasDefrosted` — не зависит от списка
        // source-ов, поэтому новые заказы того же блюда не меняют id карточки.
        // Повторные вхождения того же блюда получают порядковый суффикс:
        // первая позиция — старый формат (без суффикса), вторая — `..._1` и т.д.
        const baseVirtualId = `smart_${group.dishId}_${group.wasDefrosted ? '1' : '0'}`;
        const occurrence = seenVirtualKeys.get(baseVirtualId) ?? 0;
        seenVirtualKeys.set(baseVirtualId, occurrence + 1);
        const virtualId = occurrence === 0 ? baseVirtualId : `${baseVirtualId}_${occurrence}`;

        // Считаем сколько порций каждого реального заказа в этой группе
        const itemCountByOrder = new Map<string, number>();
        for (const item of group.items) {
          itemCountByOrder.set(item.orderId, (itemCountByOrder.get(item.orderId) || 0) + 1);
        }

        newMapping.set(virtualId, {
          sourceOrderIds: group.sourceOrderIds,
          itemCountByOrder,
        });

        // Сборка стека по персистентному флагу merge_ack (миграция 022).
        // Подтверждённые source-ы (merge_ack=TRUE в slicer_order_state) →
        // один объединённый блок (суммарное qty, все столы); новые source-ы
        // (merge_ack=FALSE) — отдельными блоками. Так нарезчик видит "2 + 1",
        // если раньше было "1+1 merge = 2", а потом пришёл ещё один заказ
        // того же блюда. Флаг живёт в БД → merge переживает F5, переключение
        // вкладок и синхронен между несколькими планшетами (раньше состояние
        // было в локальном стейте и терялось при любом размонтировании).
        let mergedQty = 0;
        const mergedTables: number[] = [];
        const unmergedBlocks: { qty: number; tables: number[] }[] = [];

        for (const sourceId of group.sourceOrderIds) {
          const count = itemCountByOrder.get(sourceId) || 0;
          const sourceOrder = activeOrders.find(o => o.id === sourceId);
          // Order не имеет поля `tableNumber` — все столы лежат в `table_stack`
          // (массив массивов: один блок на каждый стек после merge). Раньше тут
          // был фолбэк на `sourceOrder.tableNumber || 0`, который всегда
          // резолвился в [0] и давал phantom-блок «стол 0» в Smart Wave defrost
          // mini-cards. Убираем фолбэк, оставляем только реальные столы.
          const sourceTables = sourceOrder
            ? (sourceOrder.table_stack?.flat() || []).filter(Boolean)
            : [];
          const tablesForBlock = sourceTables.length > 0 ? sourceTables : [0];

          if (sourceOrder?.merge_ack) {
            mergedQty += count;
            mergedTables.push(...tablesForBlock);
          } else {
            unmergedBlocks.push({ qty: count, tables: tablesForBlock });
          }
        }

        let quantityStack: number[] = [];
        let tableStack: number[][] = [];
        if (mergedQty > 0) {
          quantityStack.push(mergedQty);
          // Дедуп столов объединённого блока: N подтверждённых порций одного
          // стола давали «столы: 5, 5, 5» вместо «стол 5» (ревью 2026-07-11).
          tableStack.push([...new Set(mergedTables)]);
        }
        for (const block of unmergedBlocks) {
          quantityStack.push(block.qty);
          tableStack.push(block.tables);
        }
        // Edge case: если вся группа в mergedSet, unmergedBlocks пусто → получим
        // [mergedQty] / [[mergedTables]] — один блок, карточка в «merged» виде.
        // Если merged пустой и unmerged тоже (не должно случиться) — пустой стек.

        // Если группа состоит из уже размороженных source-ов — пробрасываем
        // defrost-метаданные с одного из них в virtualOrder. Это нужно чтобы
        // OrderCard увидел hasDefrostBeenStarted(order)=true и (а) отрисовал
        // серую ❄️-индикацию «уже размораживалось», (б) СКРЫЛ синюю кнопку
        // запуска.
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

        // Таймер виртуальной карточки: `elapsed = (now - created_at) - accumulated`.
        // Чтобы на виртуальной показывалось корректное «максимальное активное
        // время среди source-ов», вычисляем effective_start = min(c_i + a_i).
        // Тогда elapsed_virtual = now - min(c+a) = max((now - c_i) - a_i) = max
        // активного времени по source-ам. `accumulated_time_ms` оставляем 0:
        // само время уже учтено в смещении `created_at`.
        // Сортировку groups.sort это не трогает — она работает с
        // SmartQueueGroup.earliestOrderTime, не с virtualOrder.created_at.
        const sourceOrdersInGroup = group.sourceOrderIds
          .map(id => activeOrders.find(o => o.id === id))
          .filter((o): o is Order => !!o);
        const effectiveStart = sourceOrdersInGroup.length > 0
          ? Math.min(...sourceOrdersInGroup.map(s => s.created_at + (s.accumulated_time_ms || 0)))
          : group.earliestOrderTime;

        // История парковок source-ов — нужна OrderCard'у чтобы подсветить столы
        // фиолетовой рамочкой («этот стол хоть раз паркавался в течение смены»).
        // `was_parked` = true если хоть один source когда-либо паркавался;
        // `parked_tables` = объединение всех паркованных столов по source-ам.
        // Без этого проброса рамочка в Smart Wave пропадала (поля были undefined
        // на virtualOrder и OrderCard рисовал столы как обычные жёлтые).
        const wasParkedAny = sourceOrdersInGroup.some(s => !!s.was_parked);
        const parkedTablesUnion = Array.from(new Set<number>(
          sourceOrdersInGroup.flatMap(s => s.parked_tables || [])
        ));

        const virtualOrder: Order = {
          id: virtualId,
          dish_id: group.dishId,
          quantity_stack: quantityStack,
          table_stack: tableStack,
          created_at: effectiveStart,
          updated_at: Date.now(),
          status: 'ACTIVE',
          accumulated_time_ms: 0,
          was_parked: wasParkedAny,
          parked_tables: parkedTablesUnion,
          defrost_started_at: defrostStartedAt,
          defrost_duration_seconds: defrostDurationSeconds,
        };

        return virtualOrder;
      });

      smartQueueMappingRef.current = newMapping;
      return virtualOrders;
    }

    // ====================================================================
    // СТАНДАРТНАЯ СОРТИРОВКА (оба режима агрегации выключены):
    // каждая позиция чека — отдельная карточка, без объединения.
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
          const isUltraA = dishA.priority_flag === PriorityLevel.ULTRA;
          const isUltraB = dishB.priority_flag === PriorityLevel.ULTRA;
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
    // `now` в зависимостях = пересборка раз в секунду. Это дёшево (порций на
    // доске десятки, не тысячи), карточки и так перерисовываются каждый тик
    // из-за таймеров, зато исчезают гонки со временем: истёкшая разморозка
    // возвращается в сетку мгновенно в обоих режимах очереди.
  }, [activeOrders, dishes, categories, settings, now]);

  // Чистка «В работе»: якоря, исчезнувшие с доски (карточка завершена,
  // отменена или ушла в разморозку), убираем из набора. Без этого якорь
  // следующего заказа того же блюда появлялся бы уже помеченным 🔪, хотя
  // его никто не брал. Сравниваем по якорям (см. claimAnchorOf) — метка
  // следует за карточкой, а не за нестабильным виртуальным id.
  useEffect(() => {
    setInWorkIds(prev => {
      if (prev.size === 0) return prev;
      const boardAnchors = new Set(sortedOrders.map(o => claimAnchorOf(o.id)));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (boardAnchors.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sortedOrders, claimAnchorOf]);

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
  // Снапшот source-ов виртуальной карточки, снятый В МОМЕНТ ОТКРЫТИЯ модалки
  // «Частично» (ревью 2026-07-11): очередь пересобирается каждую секунду, и
  // виртуальный id с порядковым суффиксом к моменту «ОК» мог указывать на
  // ДРУГУЮ карточку того же блюда (частичная отдача ушла бы на чужой стол)
  // либо исчезнуть из маппинга (отдача молча терялась). null = стандартный
  // режим, id реальный.
  const [partialSources, setPartialSources] = useState<Map<string, number> | null>(null);

  return (
    <div className="p-6 overflow-y-auto h-full flex flex-col relative">
      {partialOrder && onPartialComplete && (
        <PartialCompletionModal
          totalQty={partialOrder.quantity_stack.reduce((a, b) => a + b, 0)}
          onConfirm={(qty) => {
            // Smart Aggregation: распределить PartDone по реальным source orders.
            // Source-ы берём из СНАПШОТА partialSources (снят при открытии
            // модалки — см. коммент у стейта), а не из текущего маппинга:
            // за время набора количества очередь пересобиралась каждую
            // секунду и виртуальный id мог начать указывать на чужую карточку.
            // Source-ы сортируем по created_at ASC — закрываем СТАРЫЕ заказы
            // первыми (FIFO). Без этой сортировки порядок зависел от
            // Map-insertion-order, который не гарантирует FIFO.
            if (partialSources) {
              let remainingToComplete = qty;
              const sourceEntries = Array.from(partialSources.entries())
                .map(([sourceId, maxCount]) => {
                  const sourceOrder = orders.find(o => o.id === sourceId);
                  return {
                    sourceId,
                    maxCount,
                    sortKey: sourceOrder?.created_at ?? Number.POSITIVE_INFINITY,
                    sourceOrder,
                  };
                })
                .sort((a, b) => a.sortKey - b.sortKey);
              for (const { sourceId, maxCount, sourceOrder } of sourceEntries) {
                if (remainingToComplete <= 0) break;
                // Source успел завершиться/исчезнуть, пока модалка была
                // открыта — просто пропускаем его, не роняя остальных.
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
            setPartialSources(null);
          }}
          onClose={() => { setPartialOrder(null); setPartialSources(null); }}
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
                  // Создаём виртуальный Order для модалки PartialCompletion.
                  // Source-ы фиксируем СЕЙЧАС (снапшот) — к моменту «ОК»
                  // маппинг мог быть пересобран под другую карточку.
                  const virtualOrder = sortedOrders.find(o => o.id === id);
                  if (virtualOrder) {
                    setPartialOrder(virtualOrder);
                    setPartialSources(new Map(mapping.itemCountByOrder));
                  }
                } else {
                  const o = orders.find(x => x.id === id);
                  if (o) {
                    setPartialOrder(o);
                    setPartialSources(null);
                  }
                }
              }}
              onStackMerge={(id) => {
                // Smart Aggregation: подтверждаем ТЕКУЩИЕ source-ы карточки —
                // merge_ack=TRUE в БД (миграция 022). Новые source-ы придут
                // с merge_ack=FALSE и отрисуются отдельным блоком — "2 + 1".
                const mapping = smartQueueMappingRef.current.get(id);
                if (mapping) {
                  onMergeAck?.(mapping.sourceOrderIds);
                } else {
                  onStackMerge(id);
                }
              }}
              onCancelOrder={(id) => {
                // Smart Wave: virtual id → реальные source order_item_id.
                // Стопнутое блюдо может быть собрано из нескольких source-ов
                // (1+1+1 со стола 5,8,12) — отменяем все сразу, иначе на доске
                // останется огрызок группы.
                const sourceIds = resolveSourceOrderIds(id);
                for (const sid of sourceIds) {
                  onCancelOrder?.(sid);
                }
              }}
              onPreviewImage={onPreviewImage}
              isInWork={inWorkIds.has(claimAnchorOf(order.id))}
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
                // table_stack — обязательное поле Order (см. types.ts), фолбэк
                // на легаси `table_numbers` удалён: такого поля в типе нет.
                Array.from(new Set(orders
                  .filter(o => o.status === 'PARKED')
                  .flatMap(o => (o.table_stack || []).flat())
                )).map(tableNum => {
                  const tableOrders = orders.filter(o =>
                    o.status === 'PARKED' &&
                    (o.table_stack || []).flat().includes(tableNum)
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