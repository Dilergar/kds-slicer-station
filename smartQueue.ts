/**
 * smartQueue.ts — Smart Wave Aggregation: волновая система очереди
 *
 * Алгоритм пошаговой симуляции:
 * 1. Развернуть стековые заказы в плоский массив (1 порция = 1 элемент)
 * 2. Отделить ULTRA-заказы (всегда на верху)
 * 3. ЦИКЛ: вычислить волны → FIFO bucket → приоритетная категория → умная агрегация → позиция
 * 4. Результат: один плоский оптимизированный список — нарезчик просто режет сверху вниз
 *
 * Ключевые принципы:
 * - Очередь заранее просчитана от начала до конца
 * - FIFO через time-bucket'ы (courseWindowMs): старые заказы обрабатываются первыми
 * - Умная кросс-bucket агрегация: одинаковое блюдо из другого bucket'а → объединяется,
 *   но ДРУГОЕ блюдо из нового bucket'а НЕ вклинивается
 * - Волна стола = первая категория по sort_index среди оставшихся блюд
 */

import { Order, Dish, Category, FlatOrderItem, SmartQueueGroup, PriorityLevel } from './types';

// ======================================================================
// Хелперы состояния разморозки (миграция 016)
// ======================================================================

/** true если разморозка идёт прямо сейчас (таймер ещё не истёк). */
export function isDefrostActive(order: Order, now: number = Date.now()): boolean {
  if (!order.defrost_started_at) return false;
  const durationMs = (order.defrost_duration_seconds ?? 0) * 1000;
  return now < order.defrost_started_at + durationMs;
}

/** true если разморозка была запущена (независимо от того, истёк таймер или нет).
 * Используется для лишения ULTRA-статуса: любой след разморозки → NORMAL. */
export function hasDefrostBeenStarted(order: Order): boolean {
  return order.defrost_started_at != null;
}

// ======================================================================
// Вспомогательная функция: определить основную категорию блюда
// Основная = категория с наименьшим sort_index.
// Блюда без slicer-категорий в очередь не попадают (фильтруются на бэке
// в GET /api/orders через EXISTS по slicer_dish_categories) — это означает,
// что блюдо готовое (рис, пампушки) и не проходит через нарезчика.
// Для тест-заказов, где dish может не иметь категорий, getPrimaryCategory
// вернёт null, и flattenOrders пропустит такую позицию.
// ======================================================================
function getPrimaryCategory(dish: Dish, categories: Category[]): Category | null {
  if (!dish.category_ids || dish.category_ids.length === 0) {
    return null;
  }

  const dishCategories = dish.category_ids
    .map(id => categories.find(c => c.id === id))
    .filter((c): c is Category => !!c);

  if (dishCategories.length === 0) return null;

  // Возвращаем категорию с наименьшим sort_index
  return dishCategories.sort((a, b) => a.sort_index - b.sort_index)[0];
}

// ======================================================================
// Шаг 1: Развёртка стековых заказов в плоский массив
// Order { quantity_stack: [2, 1], table_stack: [[8, 8], [51]] }
// → FlatOrderItem[] с 3 элементами (table 8, table 8, table 51)
// ======================================================================
function flattenOrders(
  orders: Order[],
  dishes: Dish[],
  categories: Category[],
  now: number = Date.now()
): FlatOrderItem[] {
  const items: FlatOrderItem[] = [];

  for (const order of orders) {
    // Пропускаем паркованные заказы — они не участвуют в расчёте волн
    if (order.status === 'PARKED') continue;
    // Пропускаем активно размораживающиеся — они отображаются мини-карточкой
    // в ряду над доской, не в основной очереди. Когда таймер истёк (или
    // нарезчик нажал «Разморозилась»), isDefrostActive вернёт false и
    // позиция вернётся в сетку (уже без ULTRA, см. разделение ниже).
    if (isDefrostActive(order, now)) continue;

    const rawDish = dishes.find(d => d.id === order.dish_id);
    if (!rawDish) continue;

    // Канонический id/имя/категория — у primary-блюда (если это alias).
    // /api/orders уже резолвит dish_id через COALESCE на бэке, но тест-заказы
    // добавляются локально с оригинальным alias_dish_id — их тоже нужно
    // свести в одну группу, чтобы агрегация не видела разницы между Д90 и 90.
    const canonicalDishId = rawDish.recipe_source_id || rawDish.id;
    const dish = dishes.find(d => d.id === canonicalDishId) || rawDish;

    const primaryCat = getPrimaryCategory(dish, categories);
    // Блюдо без slicer-категории = не идёт через нарезчика (готовое блюдо:
    // рис, пампушки и т.п.). Пропускаем, чтобы не отрисовывалось на доске.
    if (!primaryCat) continue;

    // Проходим по каждому блоку стека. Если table_stack пуст или блок
    // пустой — падаем на quantity_stack и генерируем порции с tableNumber=0.
    // Это защита от заказов без привязки к столу (доставка, тесты, битая
    // связка с ctlg13_halltables на бэке).
    const stackLength = Math.max(
      order.table_stack?.length || 0,
      order.quantity_stack?.length || 0,
      1
    );

    for (let blockIdx = 0; blockIdx < stackLength; blockIdx++) {
      const tablesInBlock = order.table_stack?.[blockIdx] || [];
      const blockQuantity = order.quantity_stack?.[blockIdx] ?? tablesInBlock.length ?? 1;

      // Флаг разморозки — единый для всего Order, копируем в каждый FlatItem.
      // Используется как часть ключа группировки (`groupItemsByDish`) —
      // размороженные и свежие порции одного блюда не склеиваются в одну
      // виртуальную карточку (см. коммент к полю в types.ts).
      const wasDefrosted = hasDefrostBeenStarted(order);

      // Сколько порций разворачиваем: берём МАКСИМУМ из blockQuantity и
      // числа столов, чтобы не потерять порции, если столов меньше чем qty.
      // Типичный случай: 3 порции десерта на стол 50 → quantity_stack=[3],
      // table_stack=[[50]]. Старый код бегал `for (t of tablesInBlock)` и
      // создавал 1 элемент вместо 3.
      //
      // Стол берём по индексу с фолбэком на последний — для 3 порц на 1
      // столе получим [50, 50, 50], для неоднородных блоков [[50,51]] qty=2
      // получим [50, 51]. Если столов вообще нет — 0 как tableNumber.
      const portions = Math.max(blockQuantity, tablesInBlock.length, 1);

      for (let i = 0; i < portions; i++) {
        const tableNumber = tablesInBlock.length > 0
          ? (tablesInBlock[i] ?? tablesInBlock[tablesInBlock.length - 1])
          : 0;
        items.push({
          orderId: order.id,
          dishId: dish.id,
          dishName: dish.name,
          category: primaryCat.name,
          categoryId: primaryCat.id,
          tableNumber,
          orderedAt: order.created_at,
          quantity: 1,
          wasDefrosted,
        });
      }
    }
  }

  return items;
}

// ======================================================================
// Шаг 2: Определить текущую волну для конкретного стола
// Волна = категория с наименьшим sort_index среди pending блюд этого стола
// ======================================================================
function getCurrentWave(
  tableNumber: number,
  pendingItems: FlatOrderItem[],
  categories: Category[]
): Category | null {
  // Собираем все pending-элементы этого стола
  const tableItems = pendingItems.filter(item => item.tableNumber === tableNumber);
  if (tableItems.length === 0) return null;

  // Уникальные категории этого стола
  const categoryIds = [...new Set(tableItems.map(item => item.categoryId))];

  // Находим категорию с наименьшим sort_index
  const tableCats = categoryIds
    .map(id => categories.find(c => c.id === id))
    .filter((c): c is Category => !!c)
    .sort((a, b) => a.sort_index - b.sort_index);

  return tableCats[0] || null;
}

// ======================================================================
// Главная функция: построить оптимизированную очередь
//
// Алгоритм пошаговой симуляции С УЧЁТОМ FIFO:
// 1. Развернуть заказы в плоский массив
// 2. Отделить ULTRA-заказы (они всегда на верху очереди)
// 3. ЦИКЛ СИМУЛЯЦИИ:
//    a. Вычислить волну каждого стола
//    b. Собрать "in-wave" элементы
//    c. *** FIFO: среди in-wave найти САМЫЙ СТАРЫЙ bucket (временное окно) ***
//    d. Внутри этого bucket'а: найти самую приоритетную категорию
//    e. Все элементы этой категории + этого bucket'а → сгруппировать по блюду
//    f. Каждая группа → позиция в очереди
//    g. Удалить обработанные элементы из remaining
//    h. Повторить (волны пересчитаются автоматически)
//
// Ключевое правило FIFO + умная агрегация:
// Oldest bucket определяет КАТЕГОРИЮ (что готовить следующим).
// Одинаковое блюдо (по dishId) из другого bucket'а → объединяется в одну позицию.
// Другое блюдо из нового bucket'а → НЕ вклинивается (ждёт своей очереди).
// ======================================================================
export function buildSmartQueue(
  orders: Order[],
  dishes: Dish[],
  categories: Category[],
  courseWindowMs: number = 300000  // По умолчанию 5 минут (300 сек)
): SmartQueueGroup[] {
  // 1. Развернуть все заказы в плоский массив
  const allItems = flattenOrders(orders, dishes, categories);

  // Индексируем заказы по id — нужно чтобы в разделении ULTRA/normal
  // проверить флаг разморозки (он живёт на Order, не на FlatOrderItem).
  const orderById = new Map<string, Order>();
  for (const o of orders) orderById.set(o.id, o);

  // 2. Отделить ULTRA-заказы
  //    Позиция получает ULTRA только если блюдо ULTRA И разморозка ни разу
  //    не запускалась. Любой след разморозки (даже уже истёкшая) → NORMAL:
  //    требование бизнеса — после разморозки карточка встаёт в очередь на
  //    своё "естественное" место по FIFO и категории, без ULTRA-обгона.
  const ultraItems: FlatOrderItem[] = [];
  const normalItems: FlatOrderItem[] = [];

  for (const item of allItems) {
    const dish = dishes.find(d => d.id === item.dishId);
    const order = orderById.get(item.orderId);
    const wasDefrosted = order ? hasDefrostBeenStarted(order) : false;
    if (dish && dish.priority_flag === PriorityLevel.ULTRA && !wasDefrosted) {
      ultraItems.push(item);
    } else {
      normalItems.push(item);
    }
  }

  const result: SmartQueueGroup[] = [];
  let position = 1;

  // 2a. ULTRA-заказы → на верх очереди (сгруппированы по блюду, FIFO)
  if (ultraItems.length > 0) {
    const ultraGroups = groupItemsByDish(ultraItems);
    // Сортировка по FIFO
    ultraGroups.sort((a, b) => a.earliestOrderTime - b.earliestOrderTime);
    for (const group of ultraGroups) {
      group.position = position++;
      result.push(group);
    }
  }

  // 3. ЦИКЛ СИМУЛЯЦИИ для обычных заказов
  let remaining = [...normalItems];
  let safetyCounter = 0;
  const maxIterations = remaining.length + 10; // Защита от бесконечного цикла

  // Вспомогательная функция: вычислить bucket для элемента
  const getBucket = (item: FlatOrderItem): number => Math.floor(item.orderedAt / courseWindowMs);

  while (remaining.length > 0 && safetyCounter < maxIterations) {
    safetyCounter++;

    // a. Вычислить волну каждого стола
    const tableNumbers = [...new Set(remaining.map(item => item.tableNumber))];
    const waves = new Map<number, string>(); // tableNumber → categoryId (волна)

    for (const tableNum of tableNumbers) {
      const wave = getCurrentWave(tableNum, remaining, categories);
      if (wave) {
        waves.set(tableNum, wave.id);
      }
    }

    // b. Собрать все "in-wave" элементы
    // Элемент in-wave если его категория совпадает с волной его стола
    const inWaveItems = remaining.filter(item => {
      const waveCatId = waves.get(item.tableNumber);
      return waveCatId === item.categoryId;
    });

    if (inWaveItems.length === 0) {
      // Защита: если ни один элемент не попал в волну (не должно случиться),
      // добавляем оставшиеся элементы в порядке FIFO
      const fallbackGroups = groupItemsByDish(remaining);
      fallbackGroups.sort((a, b) => a.earliestOrderTime - b.earliestOrderTime);
      for (const group of fallbackGroups) {
        group.position = position++;
        result.push(group);
      }
      break;
    }

    // c. *** FIFO: найти самый старый bucket среди in-wave элементов ***
    // Это определяет какая КАТЕГОРИЯ будет обрабатываться следующей
    const oldestBucket = Math.min(...inWaveItems.map(item => getBucket(item)));

    // Только in-wave элементы из самого старого bucket'а — для определения категории
    const oldestBucketItems = inWaveItems.filter(item => getBucket(item) === oldestBucket);

    // d. Внутри этого bucket'а: найти самую приоритетную категорию
    const bucketCategoryIds = [...new Set(oldestBucketItems.map(item => item.categoryId))];
    const bucketCategories = bucketCategoryIds
      .map(id => categories.find(c => c.id === id))
      .filter((c): c is Category => !!c)
      .sort((a, b) => a.sort_index - b.sort_index);

    const priorityCategory = bucketCategories[0];

    // e. УМНАЯ АГРЕГАЦИЯ: bucket определяет КАТЕГОРИЮ + конкретные БЛЮДА
    //    Затем для каждого такого блюда — собираем его из ВСЕХ bucket'ов (cross-bucket)
    //
    //    Правила:
    //    ✅ Такое же блюдо из другого bucket'а → объединяется (Soup T2 + Soup T29)
    //    ❌ Другое блюдо из другого bucket'а → НЕ вклинивается (Гостеприимство не прыгает)
    //
    //    Это не нарушает FIFO: мы просто добавляем количество к уже
    //    существующей позиции в очереди, ничего не сдвигая.

    // Шаг 1: Блюда из приоритетной категории СТАРШЕГО bucket'а
    const oldestBucketCategoryItems = oldestBucketItems.filter(
      item => item.categoryId === priorityCategory.id
    );

    // Шаг 2: Какие конкретные dishId есть в старшем bucket'е
    const anchorDishIds = new Set(oldestBucketCategoryItems.map(i => i.dishId));

    // Шаг 3: Собираем такие же блюда (по dishId) из ВСЕХ bucket'ов (если in-wave)
    const categoryItems = inWaveItems.filter(
      item => item.categoryId === priorityCategory.id && anchorDishIds.has(item.dishId)
    );

    // f. Сгруппировать по блюду → каждая группа = позиция в очереди
    const groups = groupItemsByDish(categoryItems);

    // Сортировка внутри одной категории по FIFO
    groups.sort((a, b) => a.earliestOrderTime - b.earliestOrderTime);

    // Присваиваем позиции и добавляем в результат
    for (const group of groups) {
      group.position = position++;
      result.push(group);
    }

    // g. Удаляем обработанные элементы из remaining
    // Используем Set для быстрого поиска
    const processedSet = new Set(categoryItems);
    remaining = remaining.filter(item => !processedSet.has(item));

    // h. Волны пересчитаются автоматически в следующей итерации
  }

  return result;
}

// ======================================================================
// Вспомогательная функция: сгруппировать FlatOrderItem[] по блюду
// Одинаковые блюда → одна SmartQueueGroup
// ======================================================================
function groupItemsByDish(items: FlatOrderItem[]): SmartQueueGroup[] {
  // Ключ — пара (dishId, wasDefrosted). Уже размороженные и свежие порции
  // одного блюда идут в РАЗНЫЕ группы: иначе клик ❄️ на объединённой
  // виртуальной карточке перезапускал бы разморозку и на уже готовой рыбе.
  const dishMap = new Map<string, FlatOrderItem[]>();

  for (const item of items) {
    const key = `${item.dishId}_${item.wasDefrosted ? '1' : '0'}`;
    if (!dishMap.has(key)) {
      dishMap.set(key, []);
    }
    dishMap.get(key)!.push(item);
  }

  const groups: SmartQueueGroup[] = [];

  for (const dishItems of dishMap.values()) {
    const tables = [...new Set(dishItems.map(i => i.tableNumber))];
    const sourceOrderIds = [...new Set(dishItems.map(i => i.orderId))];

    groups.push({
      dishId: dishItems[0].dishId,
      dishName: dishItems[0].dishName,
      category: dishItems[0].category,
      categoryId: dishItems[0].categoryId,
      items: dishItems,
      sourceOrderIds,
      totalQuantity: dishItems.length, // Каждый FlatOrderItem = 1 порция
      earliestOrderTime: Math.min(...dishItems.map(i => i.orderedAt)),
      tables,
      position: 0, // Будет присвоена в buildSmartQueue
      wasDefrosted: dishItems[0].wasDefrosted,
    });
  }

  return groups;
}
