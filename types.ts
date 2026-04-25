/**
 * types.ts — Типы и интерфейсы проекта KDS Slicer Station
 *
 * Здесь описаны все TypeScript-типы:
 * - Перечисления (enum) приоритетов
 * - Сущности: ингредиенты, блюда, заказы, категории
 * - История и настройки системы
 * - Smart Wave Aggregation: FlatOrderItem, SmartQueueGroup
 */

// ======================================================================
// Перечисление уровней приоритета заказа
// NORMAL = 1 (обычный), ULTRA = 3 (максимальный приоритет)
// ======================================================================
export enum PriorityLevel {
  NORMAL = 1,
  ULTRA = 3
}

// ======================================================================
// Базовый ингредиент (используется как в стоп-листе, так и в рецептах)
// Поддерживает двухуровневую иерархию: Родитель → Разновидности (Children)
// ======================================================================
export interface IngredientBase {
  id: string;                   // Уникальный идентификатор
  name: string;                 // Название ингредиента
  parentId?: string;            // ID родительского ингредиента (если это разновидность)
  imageUrl?: string;            // URL (путь /images/ingredients/<id>.<ext>, миграция 009)
  unitType?: 'kg' | 'piece';   // Единица измерения: килограммы или штуки
  pieceWeightGrams?: number;    // Вес одной штуки в граммах (если unitType === 'piece')
  bufferPercent?: number;       // Надбавка в % для расчёта брутто в Dashboard. Миграция 010.
  is_stopped: boolean;          // Флаг: ингредиент на стопе (недоступен)
  stop_reason?: string;         // Причина стопа ("Out of Stock", "Spoilage" и т.д.)
  stop_timestamp?: number;      // Временная метка когда ингредиент был остановлен
}

// ======================================================================
// Категория меню (Soups, Salads, Горячее, Десерты, VIP и т.д.)
// sort_index определяет порядок приоритета на KDS-доске
// ======================================================================
export interface Category {
  id: string;                   // Уникальный идентификатор
  name: string;                 // Название категории
  sort_index: number;           // Индекс сортировки (0 = наивысший приоритет)
}

// ======================================================================
// Связь ингредиента с блюдом (используется внутри Dish.ingredients)
// ======================================================================
export interface DishIngredient {
  id: string;                   // ID ингредиента из IngredientBase
  quantity: number;             // Количество: граммы (если Kg) или штуки (если Piece)
}

// ======================================================================
// Блюдо (рецепт) — содержит список ингредиентов с количествами
// ======================================================================
export interface Dish {
  id: string;                   // Уникальный идентификатор
  name: string;                 // Название блюда (приходит с префиксом кода, например "163 Баклажаны")
  code?: string;                // Оригинальный code из ctlg15_dishes (для RecipeEditor)
  recipe_source_id?: string;    // ID primary блюда (если это алиас) или сам id (если independent/primary)
  category_ids: string[];       // Массив ID категорий (блюдо может быть в нескольких)
  priority_flag: PriorityLevel; // Приоритет отображения (NORMAL или ULTRA)

  grams_per_portion: number;    // Общий вес порции в граммах (авто-расчёт из ингредиентов)
  ingredients: DishIngredient[]; // Массив ингредиентов с количествами (резолвится от primary если алиас)
  image_url: string;            // URL изображения блюда

  // Логика стопа блюда (может быть автоматической при стопе ингредиента)
  is_stopped?: boolean;         // Флаг: блюдо на стопе
  stop_reason?: string;         // Причина стопа ("Missing: Potatoes" или "Manual")
  stop_timestamp?: number;      // Временная метка стопа

  // Разморозка (миграция 016): на карточке показывается кликабельная ❄️,
  // запускающая таймер разморозки. Флаг наследуется от primary-блюда через
  // recipe_source_id. Управляется в RecipeEditor.
  requires_defrost?: boolean;
  // Per-dish длительность разморозки в минутах (миграция 020). 1..60,
  // по умолчанию 15. Наследуется от primary-блюда. Snapshot пишется в
  // slicer_order_state.defrost_duration_seconds в момент клика ❄️.
  defrost_duration_minutes?: number;
}

// ======================================================================
// Заказ — основная единица на KDS-доске
// Использует "stack" архитектуру для объединения:
// - quantity_stack: [1, 1] — необъединён (показывает "1+1", красную стрелку, Done заблокирован)
// - quantity_stack: [2] — объединён (показывает "2", Done доступен)
//
// При Smart Wave Aggregation: виртуальные Order создаются из SmartQueueGroup
// со стабильным ID: smart_${dishId}_${sourceOrderIds}
// ======================================================================
export interface Order {
  id: string;                   // Уникальный идентификатор заказа
  dish_id: string;              // ID блюда из справочника Dish
  quantity_stack: number[];     // Стек количеств: [2, 1] = 2 порции + 1 порция (не объединено)
  table_stack: number[][];      // Стек столов: [[8, 5], [51]] — столы для каждого блока
  created_at: number;           // Временная метка создания (для таймера)
  updated_at: number;           // Временная метка последнего обновления

  // === Логика парковки (откладывания заказов) ===
  status: 'ACTIVE' | 'PARKED';          // Статус: активный или отложен
  parked_at?: number;                    // Когда был отложен
  unpark_at?: number;                    // Когда должен вернуться (таймер авто-возврата)
  accumulated_time_ms?: number;          // Накопленное время до парковки (для корректного таймера)
  was_parked?: boolean;                  // Был ли заказ когда-либо отложен (для KPI-отчётов)

  // Гранулярный трекинг: какие конкретно столы были отложены
  parked_tables?: number[];              // Список номеров столов, которые были/есть на парковке

  // Текущая парковка — автоматическая (миграция 017 — авто-парковка десертов).
  // Используется в useOrders.applyUnparkOptimistic и на backend /unpark для
  // правильной ветки Варианта Б (миграция 019): авто → «как новый заказ»,
  // ручная → возврат на историческое место.
  parked_by_auto?: boolean;

  // === Разморозка (миграция 016) ===
  // defrost_started_at: unix ms клика по ❄️. null/undefined = разморозка не запускалась.
  // defrost_duration_seconds: snapshot defrost_duration_minutes*60 в момент клика
  // (не перевычисляется при изменении глобальной настройки).
  // Состояние «в процессе» = defrost_started_at != null && now < started + duration*1000
  // «Разморожено» = defrost_started_at != null && now >= started + duration*1000
  defrost_started_at?: number | null;
  defrost_duration_seconds?: number | null;
}

// ======================================================================
// Запись истории стоп-листа (для отчётности)
// Создаётся при снятии ингредиента/блюда со стопа
// ======================================================================
export interface StopHistoryEntry {
  id: string;                   // Уникальный идентификатор записи
  ingredientName: string;       // Название ингредиента/блюда (блюда с префиксом "[DISH]")
  stoppedAt: number;            // Когда был поставлен на стоп
  resumedAt: number;            // Когда был снят со стопа
  reason: string;               // Причина стопа
  durationMs: number;           // Длительность стопа в миллисекундах
  // Актор (миграция 014). Может быть null для записей до миграции или если
  // rgst3.inserter не резолвился в users. UI показывает «—» в этом случае.
  stoppedByUuid?: string | null;
  stoppedByName?: string | null;
  resumedByUuid?: string | null;
  resumedByName?: string | null;
  actorSource?: 'slicer' | 'kds' | 'cascade' | null;
  /**
   * Склады, к которым привязано блюдо через `ctlg18_menuitems` (Кухня, Бар,
   * Склад и т.п.). Для ингредиентов всегда пустой массив. Для dish-записей
   * без menu item — тоже пустой (старые/удалённые блюда). Используется в UI
   * «История стоп-листов» для фильтра по складу — список вариантов
   * приходит автоматически из реальных данных, без хардкода имён.
   */
  storages?: { id: string; name: string }[];
}

// ======================================================================
// Запись истории выполненного заказа (для отчётности и восстановления)
// ======================================================================
export interface OrderHistoryEntry {
  id: string;                   // Уникальный идентификатор записи
  dishId: string;               // ID блюда
  dishName: string;             // Название блюда (может содержать пометку "(Partial)")
  completedAt: number;          // Временная метка завершения
  totalQuantity: number;        // Общее количество порций
  prepTimeMs: number;           // Время приготовления (от создания до завершения)
  was_parked?: boolean;         // Был ли заказ паркован (для разделения KPI)
  snapshot: Order;              // Полный снимок заказа (для возможности восстановления)
  consumedIngredients: {        // Массив потреблённых ингредиентов
    id: string;                 // ID ингредиента
    name: string;               // Название
    imageUrl?: string;          // URL изображения
    unitType: 'kg' | 'piece';  // Единица измерения
    quantity: number;           // Количество (штуки или граммы)
    weightGrams: number;        // Всегда в граммах (для агрегации и сортировки)
  }[];
}

// ======================================================================
// Запись метрики «скорость готовки повара» (Dashboard → ChefCookingSpeedSection)
// Пара (finished_at → docm2tabl1_cooktime): время между нажатием «Готово»
// нарезчиком и отметкой готовности блюда на раздаче.
// Данные берутся JOIN-ом из slicer_order_state + docm2tabl1_items (сырые записи,
// агрегация по блюду — на клиенте, аналогично SpeedKpiSection).
// ======================================================================
export interface ChefCookingEntry {
  orderItemId: string;   // docm2tabl1_items.suuid (для отладки/дедупа)
  dishId: string;        // UUID блюда (резолв алиасов: primary вместо alias_id)
  dishName: string;      // Имя блюда (primary если есть алиас)
  quantity: number;      // Кол-во порций в позиции (docm2tabl1_quantity)
  finishedAt: number;    // unix ms — когда нарезчик нажал «Готово»
  cookTimeMs: number;    // docm2tabl1_cooktime - finished_at, в миллисекундах
}

// ======================================================================
// Тип правила сортировки на KDS-доске
// 'ULTRA' — приоритет ULTRA-заказов
// 'FIFO' — строго по времени (первый пришёл — первый обслужен)
// 'CATEGORY' — по индексу категории (sort_index)
// 'COURSE_FIFO' — гибрид: внутри временного окна — по курсу, между окнами — FIFO
// ======================================================================
export type SortRuleType = 'ULTRA' | 'FIFO' | 'CATEGORY' | 'COURSE_FIFO';

// ======================================================================
// Системные настройки приложения
// Важно: enableSmartAggregation и enableAggregation взаимоисключающие
// ======================================================================
export interface SystemSettings {
  aggregationWindowMinutes: number;     // Окно агрегации заказов (по умолчанию: 5 мин, OFF)
  historyRetentionMinutes: number;      // Время хранения истории (по умолчанию: 15 мин, макс: 120)
  activePriorityRules: SortRuleType[];  // Порядок правил сортировки ['ULTRA', 'COURSE_FIFO']
  courseWindowSeconds: number;          // Временное окно FIFO-bucket в секундах (по умолчанию: 10 сек)
  restaurantOpenTime: string;           // Время открытия ресторана (HH:mm), по умолчанию "12:00"
  restaurantCloseTime: string;          // Время закрытия ресторана (HH:mm), по умолчанию "23:59"
  excludedDates: string[];              // Исключённые даты ("YYYY-MM-DD") — выходные
  enableAggregation?: boolean;          // Aggregation Window ON/OFF (по умолчанию: false)
  enableSmartAggregation?: boolean;     // Smart Wave Aggregation ON/OFF (по умолчанию: true)
  // ❗ Взаимоисключающие: Smart Wave ON → Aggregation OFF (и наоборот)
  enableKdsStoplistSync?: boolean;      // Двусторонняя синхронизация стопа блюд с rgst3_dishstoplist (по умолчанию: false). Включается программистами заказчика — см. Инструкция.md.
  // Разморозка (миграция 016, 020): время per-dish в Dish.defrost_duration_minutes,
  // здесь остаётся только глобальный toggle звука (время убрано в миграции 020).
  enableDefrostSound?: boolean;         // Звуковой сигнал при истечении таймера (по умолчанию: true)
  // Авто-парковка десертов (миграция 017). Если enabled=true и категория
  // привязана — при первом появлении дессертной позиции в GET /api/orders
  // backend сразу INSERT'ит slicer_order_state со status=PARKED и
  // unpark_at = order_time + dessertAutoParkMinutes. UI-тумблер живёт на
  // карточке дессертной категории (CategoriesTab).
  dessertCategoryId?: string | null;    // UUID slicer_categories.id, null = правило отключено
  dessertAutoParkEnabled?: boolean;     // Глобальный тумблер (по умолчанию false)
  dessertAutoParkMinutes?: number;      // На сколько минут паркуем (1..240, по умолчанию 40)
  // Паттерны LIKE (case-insensitive) для имён модификаторов из ctlg20_modifiers,
  // при наличии которых дессертная позиция уходит в авто-парковку (миграция 019).
  // По умолчанию: ['Готовить%', 'Ждать%']. Имя вида "Готовить к HH.MM" дополнительно
  // парсится и парковка ставится до сегодняшних HH:MM; иначе — на dessertAutoParkMinutes.
  dessertTriggerModifierPatterns?: string[];
}

// ======================================================================
// Режим отображения — определяет какой компонент показывать
// ======================================================================
export type ViewMode = 'KDS' | 'STOPLIST' | 'ADMIN' | 'DASHBOARD';

// ======================================================================
// Авторизованный пользователь — результат POST /api/auth/login.
// roles — массив имён ролей из чужой таблицы `roles` (может быть несколько,
// у одного юзера через userroles). Используется фронтом для решения какие
// вкладки показать (см. ROLE_ACCESS в constants.ts).
// ======================================================================
export interface AuthUser {
  uuid: string;
  login: string;
  roles: string[];
}

// ======================================================================
// Smart Wave Aggregation: Развёрнутый элемент заказа
// Один стол + одно блюдо + одна порция
// Используется для расчёта волн, FIFO-bucket'ов и агрегации
// ======================================================================
export interface FlatOrderItem {
  orderId: string;         // ID родительского Order
  dishId: string;          // ID блюда
  dishName: string;        // Название блюда
  category: string;        // Название основной категории (наименьший sort_index)
  categoryId: string;      // ID основной категории
  tableNumber: number;     // Номер стола
  orderedAt: number;       // Timestamp заказа (created_at родителя)
  quantity: number;        // Количество порций (обычно 1 при полном развёртывании)
  // Прошёл ли источник разморозку (defrost_started_at != null).
  // Используется как часть ключа группировки, чтобы размороженные и свежие
  // порции одного блюда не склеивались в одну виртуальную карточку —
  // иначе повторный клик ❄️ перезапустит разморозку уже готовой рыбе.
  wasDefrosted: boolean;
}

// ======================================================================
// Smart Wave Aggregation: Позиция в оптимизированной очереди
// Результат buildSmartQueue() — плоский список агрегированных блюд
// Конвертируется в виртуальные Order в SlicerStation.tsx
// ======================================================================
export interface SmartQueueGroup {
  dishId: string;                  // ID блюда
  dishName: string;                // Название блюда
  category: string;                // Название категории
  categoryId: string;              // ID категории
  items: FlatOrderItem[];          // Все элементы в группе
  sourceOrderIds: string[];        // ID оригинальных Order объектов
  totalQuantity: number;           // Суммарное количество порций
  earliestOrderTime: number;       // Время самого раннего заказа (для FIFO)
  tables: number[];                // Уникальные номера столов
  position: number;                // Позиция в очереди (1, 2, 3...)
  // Все items в группе имеют одинаковый defrost-статус (группировка идёт
  // по паре dishId + wasDefrosted). true → показать серую ❄️-индикацию
  // и скрыть кнопку запуска на виртуальной карточке.
  wasDefrosted: boolean;
}