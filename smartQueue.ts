/**
 * smartQueue.ts — два движка очереди нарезчика
 *
 * 1. buildSmartQueue — «Волновая Агрегация (Умная)», модель «Темп курсов»:
 *    качество без потери скорости. Сохраняет порядок курсов каждого гостя и
 *    честность по времени прихода между столами, объединяя одинаковые блюда
 *    там, где это ничего не нарушает.
 *
 *    Пайплайн:
 *    1. Развернуть стековые заказы в плоский массив (1 порция = 1 элемент)
 *    2. Отделить ULTRA-заказы (всегда на верху, FIFO)
 *    3. Виртуальное время позиции vt = max(пробитие, старт визита + курс×шаг).
 *       Курсы гостя ЗАМОРОЖЕНЫ по всему визиту (2026-07-11): считаются по всем
 *       позициям — активным, размораживающимся и УЖЕ ОТДАННЫМ (контекст
 *       visit_* с бэка), поэтому «Готово» не пересобирает очередь
 *    4. Сортировка по vt → жадная сборка карточек: одинаковое блюдо вливается
 *       в верхнюю карточку не выше последнего предыдущего курса гостя; ключ
 *       карточки фиксируется при создании — вливания её не двигают
 *
 *    Ключевые свойства:
 *    - vt — это ТОЛЬКО порядок при конкуренции, не блокировка: при свободной
 *      очереди нарезчик сразу режет верхнюю карточку, простоя нет
 *    - После наступления vt позицию уже никто не обгонит: любой новый заказ
 *      получает vt не раньше своего пробития, то есть не раньше «сейчас»
 *    - Гость (waveKey) = стол или чек доставки
 *
 * 2. buildSpeedQueue — «Окно Агрегации» (режим скорости): отдать все блюда
 *    как можно быстрее. Порядок категорий НЕ сохраняется, одинаковые блюда
 *    объединяются в одну карточку без ограничения по времени, карточки идут
 *    строго по времени ПЕРВОГО заказа (FIFO). Дизайн владельца, 2026-07-06.
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
 * Используется для (а) разделения агрегации — размороженные и свежие порции
 * одного блюда идут в РАЗНЫЕ виртуальные карточки (защита от перезапуска
 * таймера), (б) индикации в OrderCard — статичная серая ❄️ «проходило
 * разморозку». На ULTRA-статус НЕ влияет — ULTRA сохраняется после разморозки. */
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

/**
 * Ключ «гостя» (waveKey) по номеру стола и заказу: стол — общий гость
 * (`t<номер>`), позиция без стола (доставка/самовывоз) — чек чужой KDS
 * (`o<id чека>`), чтобы независимые доставки не сцеплялись в один
 * виртуальный «стол 0». Фолбэк на order.id — для тест-заказов без
 * source_order_id.
 *
 * ⚠️ КОНТРАКТ ФРОНТ↔БЭК: формат обязан байт-в-байт совпадать с visitKeyFor()
 * в server/src/routes/orders.ts — по этим строкам контекст визита
 * (visit_completed_dish_ids / visit_started_at) совмещается с активными
 * позициями. Менять только синхронно (ревью 2026-07-11: раньше формат был
 * выписан вручную в четырёх местах и мог молча разъехаться).
 *
 * @param tableNumber Номер стола (0 = стола нет)
 * @param order Заказ — источник id чека для позиций без стола
 * @returns Строковый ключ гостя
 */
const waveKeyFor = (tableNumber: number, order: Order): string =>
  tableNumber > 0 ? `t${tableNumber}` : `o${order.source_order_id || order.id}`;

/**
 * Каноническое блюдо по id: если это alias (163/Д163 — общий рецепт),
 * резолвим через recipe_source_id на primary. Единая точка канонизации —
 * используется и при развёртке активных позиций (flattenOrders), и при
 * расчёте курсов по уже отданным (courseCategoryOf в buildSmartQueue).
 *
 * @param dishId id блюда (возможно alias)
 * @param dishById Справочник блюд с O(1)-доступом
 * @returns Primary-блюдо, само блюдо (если не alias) или null (не найдено)
 */
const canonicalDishOf = (dishId: string, dishById: Map<string, Dish>): Dish | null => {
  const raw = dishById.get(dishId);
  if (!raw) return null;
  return (raw.recipe_source_id && dishById.get(raw.recipe_source_id)) || raw;
};

/**
 * Разделить плоские позиции на ULTRA и обычные. ULTRA-статус блюда не
 * зависит от разморозки — раз блюдо ULTRA, оно остаётся ULTRA и после.
 * Общий шаг обоих движков очереди (умного и скоростного) — правило
 * «ULTRA всегда сверху» обязано совпадать в них байт-в-байт.
 *
 * @param items Плоские позиции (после flattenOrders)
 * @param dishById Справочник блюд с O(1)-доступом
 * @returns Пара массивов: ULTRA-позиции и обычные
 */
function partitionUltra(
  items: FlatOrderItem[],
  dishById: Map<string, Dish>
): { ultraItems: FlatOrderItem[]; normalItems: FlatOrderItem[] } {
  const ultraItems: FlatOrderItem[] = [];
  const normalItems: FlatOrderItem[] = [];
  for (const item of items) {
    const dish = dishById.get(item.dishId);
    if (dish && dish.priority_flag === PriorityLevel.ULTRA) {
      ultraItems.push(item);
    } else {
      normalItems.push(item);
    }
  }
  return { ultraItems, normalItems };
}

/**
 * Сгруппировать позиции по блюду и отсортировать группы строгим FIFO по
 * самому раннему заказу. Общий финальный шаг для ULTRA-секции умной очереди
 * и обеих секций скоростной — чтобы правило FIFO не разъезжалось по копиям.
 *
 * @param items Плоские позиции одной секции
 * @returns Группы в порядке выдачи (position проставляет вызывающий код)
 */
function fifoGroups(items: FlatOrderItem[]): SmartQueueGroup[] {
  const groups = groupItemsByDish(items);
  groups.sort((a, b) => a.earliestOrderTime - b.earliestOrderTime);
  return groups;
}

/**
 * Запись липкого кэша виртуального времени позиции (между пересборками).
 * vt по дизайну неизменен всю жизнь позиции (см. шапку buildSmartQueue) —
 * кэш делает это свойство буквальным: пересчёт происходит только когда
 * legit-но изменилось эффективное время пробития (парковка Вариант Б,
 * restore) или шаг курса (правка настройки в админке).
 */
export interface PersistentVtEntry {
  /** Эффективное время пробития на момент расчёта (валидатор кэша) */
  orderedAt: number;
  /** Шаг курса на момент расчёта (валидатор кэша) */
  paceMs: number;
  /** Запомненное виртуальное время позиции */
  vt: number;
}

// ======================================================================
// Шаг 1: Развёртка стековых заказов в плоский массив
// Order { quantity_stack: [2, 1], table_stack: [[8, 8], [51]] }
// → FlatOrderItem[] с 3 элементами (table 8, table 8, table 51)
// ======================================================================
function flattenOrders(
  orders: Order[],
  dishById: Map<string, Dish>,
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
    // позиция вернётся в сетку. ULTRA-статус сохраняется как до, так и
    // после разморозки — раз блюдо ULTRA, оно остаётся ULTRA.
    if (isDefrostActive(order, now)) continue;

    // Канонический id/имя/категория — у primary-блюда (если это alias).
    // /api/orders уже резолвит dish_id через COALESCE на бэке, но тест-заказы
    // добавляются локально с оригинальным alias_dish_id — их тоже нужно
    // свести в одну группу, чтобы агрегация не видела разницы между Д90 и 90.
    const dish = canonicalDishOf(order.dish_id, dishById);
    if (!dish) continue;

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

      // Сколько порций разворачиваем: quantity — источник истины.
      // Типичный случай: 3 порции десерта на стол 50 → quantity_stack=[3],
      // table_stack=[[50]] → 3 элемента. Фолбэк на число столов — только
      // когда qty неизвестно (0/undefined). Раньше брали max(qty, tables),
      // и лишние столы в блоке (артефакты restore-конкатенации) рождали
      // фантомные порции, которых нет в чеке.
      //
      // Стол берём по индексу с фолбэком на последний — для 3 порц на 1
      // столе получим [50, 50, 50], для неоднородных блоков [[50,51]] qty=2
      // получим [50, 51]. Если столов вообще нет — 0 как tableNumber.
      const portions = Math.max(blockQuantity > 0 ? blockQuantity : tablesInBlock.length, 1);

      for (let i = 0; i < portions; i++) {
        const tableNumber = tablesInBlock.length > 0
          ? (tablesInBlock[i] ?? tablesInBlock[tablesInBlock.length - 1])
          : 0;
        // Ключ «гостя» для волн — через единый waveKeyFor (контракт с бэком).
        const waveKey = waveKeyFor(tableNumber, order);
        items.push({
          orderId: order.id,
          dishId: dish.id,
          dishName: dish.name,
          category: primaryCat.name,
          categoryId: primaryCat.id,
          tableNumber,
          waveKey,
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
// «Волновая Агрегация (Умная)» v2 — модель «ТЕМП КУРСОВ» (2026-07-07,
// дизайн владельца; 2026-07-11 — курсы заморожены по визиту).
//
// Идея: каждый гость (стол / чек доставки) движется по СВОИМ курсам
// независимо. Стол с одним десертом не ждёт, пока большие столы пройдут
// все свои курсы; большой стол не голодает из-за потока новых маленьких.
//
// Механика:
//   1. Курсы гостя = уникальные категории ВСЕХ позиций его ВИЗИТА,
//      отсортированные по sort_index: первая — курс 0, следующая — курс 1
//      и т.д. «Все позиции визита» = активные на доске + активно
//      размораживающиеся + УЖЕ ОТДАННЫЕ нарезчиком (backend отдаёт их в
//      Order.visit_completed_dish_ids / visit_started_at по открытым чекам
//      гостя). Заморозка по визиту (2026-07-11) — ключевое свойство:
//      «Готово» НЕ пересобирает очередь. Раньше курс считался только по
//      оставшимся позициям — после отдачи супа горячее «повышалось» до
//      курса 0, его vt падал до времени пробития, и стол получал все блюда
//      подряд, обгоняя первые курсы соседей (ревью 2026-07-11).
//      Паркованные позиции курсами НЕ считаются: парковка = «отложено»,
//      Вариант Б возвращает их «как новые». ULTRA — вне курсов (вне очереди).
//   2. Виртуальное время позиции:
//        vt = max(время пробития позиции,
//                 время первого заказа гостя + курс × шаг)
//      где шаг = slicer_settings.course_pace_seconds — ОКНО УСТУПКИ: на
//      сколько курс N стола уступает дорогу первым курсам гостей, пришедших
//      позже (по умолчанию 600 сек, миграция 024; правится в UI рядом с
//      тумблером режима). vt — только порядок при конкуренции, НЕ задержка:
//      при свободной очереди блюдо режется сразу. max(...) — защита для
//      дозаказов: блюдо не встаёт в очередь раньше, чем его пробили.
//   3. Позиции сортируются по (vt → категория → время пробития) и жадно
//      собираются в карточки:
//      - одинаковое блюдо ВЛИВАЕТСЯ в самую верхнюю карточку этого блюда,
//        стоящую НИЖЕ карточки последнего предыдущего курса этого гостя —
//        слияние не может дать гостю курс N раньше курса N−1. Когда прежний
//        ограничитель отдан (суп гостя завершён), его следующий курс на
//        пересборке легально вливается выше — это единственная «пересборка»
//        после «Готово», и она только ускоряет;
//      - иначе создаётся новая карточка с ключом vt. Ключ фиксируется при
//        создании: вливания НЕ двигают карточку («десерт не сползает»).
//   4. ULTRA-блюда — отдельно сверху (FIFO), как во всех режимах.
//
// Защита от голодания (почему это лучше и чистых «тактов», и старого FIFO):
//   - Стол с одним десертом: vt = времени его заказа → впереди только то,
//     что «виртуально раньше», а не все курсы больших столов.
//   - Большой стол: его курс N имеет фиксированный vt = заказ + N×шаг.
//     Столы, пришедшие после этого момента, встают ПОЗЖЕ — второй курс
//     старожила уступает новичкам максимум N×шаг, после наступления vt
//     его уже никто не обгонит (новые заказы получают vt ≥ «сейчас»).
// ======================================================================
export function buildSmartQueue(
  orders: Order[],
  dishes: Dish[],
  categories: Category[],
  // Шаг курса — обязательный параметр БЕЗ значения по умолчанию (ревью
  // 2026-07-11): прежний дефолт 120000 противоречил дефолту системы (600 сек,
  // миграция 024) и молча давал «сломанную» очередь любому вызову без
  // аргумента. Единственный фолбэк живёт у вызывающего (SlicerStation, || 600).
  coursePaceMs: number,
  now: number = Date.now(),         // Момент расчёта — передаётся из тикающего
                                    // стейта SlicerStation, чтобы истёкшие
                                    // разморозки возвращались в очередь сразу
  // Липкий кэш vt между пересборками (ключ — id реального заказа; все порции
  // заказа делят один vt). Делает инвариант «vt неизменен всю жизнь позиции»
  // буквальным: без кэша vt «проседал» в окно между оптимистичным «Готово» и
  // приходом свежего visit-контекста со следующим polling (~4 сек), а также
  // при снятии категории с уже отданного блюда посреди смены — карточки
  // прыгали, воспроизводя тот самый «промоушен курса», который лечила
  // заморозка курсов (ревью 2026-07-11). undefined = без кэша (тесты).
  persistentVt?: Map<string, PersistentVtEntry>
): SmartQueueGroup[] {
  // Справочник блюд с O(1)-доступом: раньше каждый dishes.find сканировал
  // весь справочник (~сотни блюд) на КАЖДУЮ порцию, и это повторялось при
  // ежесекундной пересборке очереди.
  const dishById = new Map(dishes.map(d => [d.id, d]));

  // 1. Развернуть все заказы в плоский массив (парковка/активная разморозка/
  //    блюда без категории отфильтрованы внутри)
  const allItems = flattenOrders(orders, dishById, categories, now);

  // 2. Отделить ULTRA-заказы (общий с buildSpeedQueue хелпер).
  const { ultraItems, normalItems } = partitionUltra(allItems, dishById);

  const result: SmartQueueGroup[] = [];
  let position = 1;

  // 2a. ULTRA-заказы → на верх очереди (сгруппированы по блюду, FIFO)
  for (const group of fifoGroups(ultraItems)) {
    group.position = position++;
    result.push(group);
  }

  // 3. Курсы и время старта каждого гостя — ЗАМОРОЖЕНЫ на весь визит
  //    (2026-07-11). Курс = ранг категории среди ВСЕХ категорий визита:
  //      (а) активные позиции на доске (normalItems);
  //      (б) активно размораживающиеся — они временно сняты с доски, но
  //          остаются курсами гостя (иначе уход рыбы в разморозку «повышал»
  //          бы его десерт — тот же эффект, что промоушен после «Готово»);
  //      (в) уже отданные позиции визита (Order.visit_completed_dish_ids +
  //          visit_started_at с бэка, по открытым чекам гостя).
  //    Благодаря этому vt позиции неизменен всю её жизнь: «Готово» просто
  //    снимает верхнюю карточку, остальные не двигаются и ручка шага курса
  //    честно управляет порядком. Паркованные позиции в курсы не входят
  //    (парковка = «отложено», Вариант Б вернёт их «как новые»).
  const catSortIndex = new Map(categories.map(c => [c.id, c.sort_index]));
  const guestStart = new Map<string, number>();      // waveKey → старт визита (min по позициям)
  const guestCatSet = new Map<string, Set<string>>(); // waveKey → категории визита

  /**
   * Добавить в контекст гостя категорию (может быть null — тогда только
   * подвинуть время старта визита) и время пробития позиции.
   */
  const addToGuest = (waveKey: string, categoryId: string | null, at: number) => {
    guestStart.set(waveKey, Math.min(guestStart.get(waveKey) ?? Infinity, at));
    if (categoryId) {
      if (!guestCatSet.has(waveKey)) guestCatSet.set(waveKey, new Set());
      guestCatSet.get(waveKey)!.add(categoryId);
    }
  };

  // (а) Активные позиции на доске
  for (const item of normalItems) {
    addToGuest(item.waveKey, item.categoryId, item.orderedAt);
  }

  /**
   * waveKey-ключи «гостей» заказа — через единый waveKeyFor (те же правила,
   * что во flattenOrders): столы из table_stack → `t<номер>`, позиции без
   * стола → чек `o<id>`.
   */
  const orderWaveKeys = (order: Order): string[] => {
    const tables = [...new Set((order.table_stack || []).flat().filter(t => t > 0))];
    if (tables.length > 0) return tables.map(t => waveKeyFor(t, order));
    return [waveKeyFor(0, order)];
  };

  /**
   * Основная категория блюда по его id (канонизация — общий canonicalDishOf,
   * тот же, что в flattenOrders). Возвращает null, если блюдо не найдено,
   * без slicer-категории или ULTRA — такие в расчёте курсов не участвуют
   * (ULTRA идёт вне очереди, как и в активной части выше).
   * Мемоизирована по dishId: списки отданных блюд разных гостей часто
   * пересекаются, а пересборка идёт каждую секунду.
   */
  const courseCatCache = new Map<string, string | null>();
  const courseCategoryOf = (dishId: string): string | null => {
    if (courseCatCache.has(dishId)) return courseCatCache.get(dishId)!;
    const canonical = canonicalDishOf(dishId, dishById);
    const catId = !canonical || canonical.priority_flag === PriorityLevel.ULTRA
      ? null
      : getPrimaryCategory(canonical, categories)?.id ?? null;
    courseCatCache.set(dishId, catId);
    return catId;
  };

  // Контекст визита (в) обрабатываем ОДИН раз на гостя: бэк кладёт одинаковую
  // копию visit_* в каждый заказ гостя, и раньше цикл переваривал её по разу
  // на КАЖДУЮ его активную позицию (K заказов × M отданных блюд впустую).
  const visitProcessedKeys = new Set<string>();

  for (const order of orders) {
    if (order.status === 'PARKED') continue;
    const keys = orderWaveKeys(order);
    // (б) Размораживающиеся прямо сейчас — курсы визита, хоть и вне доски
    if (isDefrostActive(order, now)) {
      const catId = courseCategoryOf(order.dish_id);
      if (catId) for (const k of keys) addToGuest(k, catId, order.created_at);
    }
    // (в) Уже отданные позиции визита — по разу на waveKey. Ключ помечаем
    //     обработанным только если заказ реально НЕСЁТ данные визита:
    //     локальный тест-заказ без visit_* не должен «съесть» контекст
    //     гостя раньше настоящего заказа с бэка.
    const hasVisitData = order.visit_started_at != null
      || (order.visit_completed_dish_ids?.length ?? 0) > 0;
    if (!hasVisitData) continue;
    for (const k of keys) {
      if (visitProcessedKeys.has(k)) continue;
      visitProcessedKeys.add(k);
      if (order.visit_started_at != null) {
        addToGuest(k, null, order.visit_started_at);
      }
      for (const dishId of order.visit_completed_dish_ids ?? []) {
        const catId = courseCategoryOf(dishId);
        if (catId) addToGuest(k, catId, order.visit_started_at ?? order.created_at);
      }
    }
  }
  // waveKey → (categoryId → номер курса 0..N)
  const guestCourseIdx = new Map<string, Map<string, number>>();
  for (const [guest, catSet] of guestCatSet) {
    const sorted = [...catSet].sort(
      (a, b) => (catSortIndex.get(a) ?? 999) - (catSortIndex.get(b) ?? 999)
    );
    guestCourseIdx.set(guest, new Map(sorted.map((id, i) => [id, i])));
  }

  // 4. Виртуальное время каждой позиции (кэшируем — используется в сортировке)
  const vtCache = new Map<FlatOrderItem, number>();
  const vtOf = (item: FlatOrderItem): number => {
    let vt = vtCache.get(item);
    if (vt === undefined) {
      // Липкий кэш между пересборками (см. параметр persistentVt): однажды
      // рассчитанный vt заказа переживает пересборки, пока не изменилось
      // эффективное время пробития (парковка Вариант Б / restore меняют
      // created_at → кэш инвалидируется сам) или шаг курса (правка ручки в
      // админке должна влиять на живой порядок — тоже инвалидирует).
      const sticky = persistentVt?.get(item.orderId);
      if (sticky && sticky.orderedAt === item.orderedAt && sticky.paceMs === coursePaceMs) {
        vt = sticky.vt;
      } else {
        const courseIdx = guestCourseIdx.get(item.waveKey)?.get(item.categoryId) ?? 0;
        const start = guestStart.get(item.waveKey) ?? item.orderedAt;
        vt = Math.max(item.orderedAt, start + courseIdx * coursePaceMs);
        persistentVt?.set(item.orderId, { orderedAt: item.orderedAt, paceMs: coursePaceMs, vt });
      }
      vtCache.set(item, vt);
    }
    return vt;
  };

  // Чистка липкого кэша: держим записи, пока заказ вообще существует во
  // входных данных (включая паркованные и размораживающиеся — их vt должен
  // пережить временный уход с доски и вернуть позицию на прежнее место).
  // Исчез из orders (отдан/отменён) — запись удаляется, id не копятся.
  if (persistentVt) {
    const aliveOrderIds = new Set(orders.map(o => o.id));
    for (const key of [...persistentVt.keys()]) {
      if (!aliveOrderIds.has(key)) persistentVt.delete(key);
    }
  }

  const sortedItems = [...normalItems].sort((a, b) =>
    vtOf(a) - vtOf(b) ||
    (catSortIndex.get(a.categoryId) ?? 999) - (catSortIndex.get(b.categoryId) ?? 999) ||
    a.orderedAt - b.orderedAt
  );

  // 5. Жадная сборка карточек в порядке виртуального времени.
  interface Card {
    key: number;        // vt позиции-создателя — ФИКСИРОВАН, вливания не двигают
    catIdx: number;     // sort_index категории (тай-брейк сортировки карточек)
    tie: number;        // orderedAt позиции-создателя (финальный тай-брейк)
    dishKey: string;    // dishId + defrost-флаг (размороженное не смешиваем со свежим)
    items: FlatOrderItem[];
  }
  const cardCmp = (a: Card, b: Card) => a.key - b.key || a.catIdx - b.catIdx || a.tie - b.tie;
  const cards: Card[] = [];
  // Индекс карточек по dishKey: поиск цели слияния идёт только среди карточек
  // ТОГО ЖЕ блюда, а не сканом всех (раньше O(позиции×карточки) на каждую
  // ежесекундную пересборку). Порядок внутри бакета = порядок создания —
  // семантика поиска не меняется.
  const cardsByDishKey = new Map<string, Card[]>();
  // Для проверки «курс N не раньше курса N−1»: по каждому гостю — самая
  // нижняя карточка каждого его курса.
  const guestCourseCards = new Map<string, Map<number, Card>>();

  for (const item of sortedItems) {
    const dishKey = `${item.dishId}_${item.wasDefrosted ? '1' : '0'}`;
    const courseIdx = guestCourseIdx.get(item.waveKey)?.get(item.categoryId) ?? 0;

    // Самая нижняя карточка ПРЕДЫДУЩИХ курсов этого гостя — вливаться можно
    // только в карточки НИЖЕ неё, иначе гость получит курс N раньше N−1.
    let prev: Card | null = null;
    const courseMap = guestCourseCards.get(item.waveKey);
    if (courseMap) {
      for (const [cIdx, card] of courseMap) {
        if (cIdx < courseIdx && (!prev || cardCmp(card, prev) > 0)) prev = card;
      }
    }

    // Самая верхняя карточка того же блюда ниже prev — максимум слияния,
    // гость получает блюдо как можно раньше. Пример владельца: баранина
    // стола 2 (курс 2) вливается к баранине стола 3 (его курс 1), потому
    // что суп стола 2 стоит выше; а баранина стола 1 НЕ вливается — выше
    // той карточки ещё не отданы его салаты и грибы → отдельная карточка.
    let target: Card | null = null;
    const sameDishCards = cardsByDishKey.get(dishKey);
    if (sameDishCards) {
      for (const c of sameDishCards) {
        if (prev && cardCmp(c, prev) <= 0) continue;
        if (!target || cardCmp(c, target) < 0) target = c;
      }
    }
    if (!target) {
      target = {
        key: vtOf(item),
        catIdx: catSortIndex.get(item.categoryId) ?? 999,
        tie: item.orderedAt,
        dishKey,
        items: [],
      };
      cards.push(target);
      if (!cardsByDishKey.has(dishKey)) cardsByDishKey.set(dishKey, []);
      cardsByDishKey.get(dishKey)!.push(target);
    }
    target.items.push(item);

    // Обновляем «самую нижнюю карточку курса» гостя
    if (!guestCourseCards.has(item.waveKey)) guestCourseCards.set(item.waveKey, new Map());
    const gm = guestCourseCards.get(item.waveKey)!;
    const existing = gm.get(courseIdx);
    if (!existing || cardCmp(target, existing) > 0) gm.set(courseIdx, target);
  }

  // 6. Финальная сортировка карточек и конвертация в SmartQueueGroup
  cards.sort(cardCmp);
  for (const card of cards) {
    const tables = [...new Set(card.items.map(i => i.tableNumber))];
    const sourceOrderIds = [...new Set(card.items.map(i => i.orderId))];
    result.push({
      dishId: card.items[0].dishId,
      dishName: card.items[0].dishName,
      category: card.items[0].category,
      categoryId: card.items[0].categoryId,
      items: card.items,
      sourceOrderIds,
      totalQuantity: card.items.length,
      earliestOrderTime: Math.min(...card.items.map(i => i.orderedAt)),
      tables,
      position: position++,
      wasDefrosted: card.items[0].wasDefrosted,
    });
  }

  return result;
}

// ======================================================================
// «Окно Агрегации» — режим скорости (enable_aggregation = true)
//
// Задача: отдать все блюда быстрее. Правила (дизайн владельца, 2026-07-06):
//   1. Порядок категорий (суп → горячее) НЕ сохраняется — ни внутри стола,
//      ни между столами. Волны и курс-сортировка не применяются.
//   2. ВСЕ порции одного блюда на доске объединяются в одну карточку —
//      без ограничения по времени (пока карточка не отдана, новые порции
//      вливаются к ней).
//   3. Карточка встаёт в очередь по времени САМОГО РАННЕГО заказа и не
//      двигается: вливание новых порций не меняет её позицию, поэтому
//      «сползание вниз» (десерт, который вечно отодвигают) исключено
//      конструкцией — сортировка строго FIFO по earliestOrderTime.
//   4. ULTRA-блюда — всегда сверху (общий закон модуля, как в умной очереди).
//
// Возвращает тот же SmartQueueGroup[], что и buildSmartQueue — SlicerStation
// прогоняет результат через единый пайплайн виртуальных карточек (merge_ack,
// разморозка, распределение «Готово» по source-заказам работают одинаково).
// ======================================================================
export function buildSpeedQueue(
  orders: Order[],
  dishes: Dish[],
  categories: Category[],
  now: number = Date.now()
): SmartQueueGroup[] {
  // Справочник блюд с O(1)-доступом (симметрично buildSmartQueue).
  const dishById = new Map(dishes.map(d => [d.id, d]));

  // Развёртка та же, что в умной очереди: паркованные и активно
  // размораживающиеся пропускаются, блюда без slicer-категории — тоже
  // (готовые блюда не проходят через нарезчика — общее правило модуля).
  const allItems = flattenOrders(orders, dishById, categories, now);

  // ULTRA отделяем наверх — приоритет работает в обоих режимах одинаково
  // (общий с buildSmartQueue хелпер, копипаст убран ревью 2026-07-11).
  const { ultraItems, normalItems } = partitionUltra(allItems, dishById);

  const result: SmartQueueGroup[] = [];
  let position = 1;

  // Группировка «одно блюдо = одна карточка» (с разделением по defrost-статусу,
  // как везде) + строгий FIFO по самому раннему заказу группы. ULTRA-секция
  // и обычная используют один хелпер fifoGroups.
  for (const group of fifoGroups(ultraItems)) {
    group.position = position++;
    result.push(group);
  }
  for (const group of fifoGroups(normalItems)) {
    group.position = position++;
    result.push(group);
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
