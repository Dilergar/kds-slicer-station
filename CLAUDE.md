# CLAUDE.md — Контекст проекта для AI-агента

## ⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА (ВСЕГДА СОБЛЮДАТЬ)

### 1. Комментарии к коду — ТОЛЬКО на русском языке
- **Каждая функция** должна иметь JSDoc-комментарий на русском, описывающий что она делает, входные параметры и возвращаемое значение.
- **Каждый новый блок логики** (особенно при добавлении нового функционала) — обязательно с подробными inline-комментариями на русском.
- Комментарии должны объяснять **зачем** код делает то, что делает, а не просто **что** он делает.
- Пример:
  ```tsx
  /**
   * Обработчик завершения заказа — рассчитывает потреблённые ингредиенты,
   * записывает в историю и удаляет из активных заказов
   */
  const handleCompleteOrder = (orderId: string) => { ... }
  ```

### 2. Актуальность документации — обновлять ПОСЛЕ КАЖДОГО изменения
- **После каждого изменения кода** необходимо проверить и обновить:
  - `CLAUDE.md` — если изменилась архитектура, добавились новые файлы/компоненты/типы/паттерны
  - `README.md` — если изменились зависимости, структура проекта, функциональность или инструкции
- Это **не опционально** — документация должна быть **всегда актуальной**.
- Порядок работы: (1) Сделать изменения в коде → (2) Проверить что нужно обновить в документации → (3) Обновить `CLAUDE.md` и `README.md`.

### 3. 🔒 НЕПРИКОСНОВЕННОСТЬ ЧУЖОЙ БД (КРИТИЧЕСКИ ВАЖНО)

**БД `arclient` принадлежит IT-команде заказчика. Это рабочая продакшн-схема, которую они передали для разработки модуля.**

#### ❌ ЗАПРЕЩЕНО:
- **НЕ изменять структуру** существующих таблиц (`docm2_*`, `ctlg*`, `rgst*`, `docm1_*`, `docm3_*` — `docm9_*`, `objects`, `points`, `sessions`, `users` и т.д.)
- **НЕ добавлять** новые колонки в существующие таблицы
- **НЕ удалять** колонки или таблицы
- **НЕ переименовывать** колонки или таблицы
- **НЕ изменять** типы данных, constraints, FK, индексы существующих таблиц
- **НЕ создавать** триггеры/функции/views которые модифицируют существующие таблицы
- **НЕ делать** миграции которые меняют чужую схему

#### ✅ РАЗРЕШЕНО:
- **Читать** данные из любых существующих таблиц (SELECT)
- **Создавать** новые таблицы с префиксом `slicer_`
- **Создавать** свои индексы только на новых `slicer_*` таблицах
- **Опционально:** `INSERT/DELETE` в `rgst3_dishstoplist` через адаптер `server/src/services/kdsStoplistSync.ts`. Только если включен флаг `slicer_settings.enable_kds_stoplist_sync = true` (по умолчанию false). Это **единственное место** в коде, где модуль может трогать чужую таблицу для записи. Конфиг включения — `slicer_kds_sync_config`. См. `Инструкция.md` → раздел «Двусторонняя синхронизация стоп-листа».

#### ⚠️ РАНЬШЕ ПИСАЛИ, ТЕПЕРЬ НЕТ: `docm2tabl1_items.docm2tabl1_cooked`
Модуль **НЕ** пишет в это поле (убрано в миграции 007, 2026-04-18). Причина: блюдо может отображаться на других панелях основной KDS (раздача, пасс, мобильное приложение официанта), и нажатие нарезчиком «Готово» путало их, давая ложный сигнал «готово всё блюдо». Нарезчик закрывает позицию **только** в своей теневой таблице: `slicer_order_state.status = 'COMPLETED'` + `slicer_order_state.finished_at = NOW()`. Поле `docm2tabl1_cooked` / `docm2tabl1_cooktime` остаётся под управлением основной KDS. Разница `docm2tabl1_cooktime - slicer_order_state.finished_at` = время готовки повара (используется в отчётах Dashboard, см. `Инструкция.md` раздел 11).

#### 🎯 Цель этого правила
Когда модуль передаётся заказчику, программисты должны:
1. Получить список миграций (SQL файлы из `server/migrations/`)
2. Выполнить их на своей продакшн-БД
3. **Всё сразу заработать без ошибок** — без ручных правок схемы

Если нарушим это правило — заказчик не сможет развернуть модуль без конфликтов со своей рабочей системой.

#### Как правильно расширять функциональность
Если нужны новые поля/связи/логика:
1. Создай **новую таблицу** `slicer_*` с нужными полями
2. Связывай её с чужими таблицами через **"теневой" подход** — например, `slicer_order_state.order_item_id VARCHAR` хранит ссылку на `docm2tabl1_items.suuid` без формального FK
3. JOIN через backend при выдаче данных клиенту
4. Задокументируй в `BD_docs/tables/slicer_*.md`

**Пример правильного подхода:** `slicer_order_state` — хранит парковку/статус/merge для заказов, но не трогает `docm2_orders` и `docm2tabl1_items`.

---

## Название проекта
**KDS Slicer Station** — Kitchen Display System для станции нарезки

## Технологии
- **Frontend:** React 19 + TypeScript 5.8 + Vite 6
- **Стили:** TailwindCSS (CDN, конфиг в `index.html`)
- **Иконки:** lucide-react
- **Графики:** recharts
- **Backend:** Express 4 + pg (node-postgres), порт 3001
- **БД:** PostgreSQL 18 (arclient, localhost:5432)

## Структура файлов

```
/                           # Корень проекта
├── index.html              # HTML-шаблон, TailwindCSS CDN конфиг
├── index.tsx               # React entry point (ReactDOM.createRoot)
├── App.tsx                 # Корневой компонент: роутинг вьюшек, подключение хуков
├── types.ts                # TypeScript типы: Order, Dish, Ingredient, Settings...
├── utils.ts                # Утилиты: generateId(), calculateConsumedIngredients()
├── smartQueue.ts           # Smart Wave Aggregation: волновая система очереди
├── constants.ts            # Начальные данные (моки)
├── vite.config.ts          # Vite: порт 3000, proxy /api → localhost:3001
├── tsconfig.json           # TS config: ES2022, react-jsx, bundler
├── eslint.config.js        # ESLint flat config (TS + React)
├── .gitignore              # Git: node_modules, dist, .env*, логи
├── services/               # Frontend API-клиент (fetch обёртки)
│   ├── client.ts           # Базовый fetch wrapper (/api → localhost:3001)
│   ├── authApi.ts          # Авторизация по PIN (POST /api/auth/login)
│   ├── ordersApi.ts        # Заказы: complete, park, unpark, merge, history
│   ├── ingredientsApi.ts   # CRUD ингредиентов
│   ├── categoriesApi.ts    # CRUD категорий + reorder
│   ├── settingsApi.ts      # GET/PUT настроек
│   ├── stoplistApi.ts      # Toggle стоп-лист + история
│   ├── dishesApi.ts        # Загрузка блюд из ctlg15_dishes
│   ├── recipesApi.ts       # GET/PUT рецептов
│   ├── chefCookingApi.ts   # Метрика «Скорость готовки повара» (Dashboard)
│   ├── dishImagesApi.ts    # Upload/delete фото блюда (multipart)
│   └── ingredientImagesApi.ts # Upload/delete фото ингредиента (multipart)
├── hooks/
│   ├── useOrders.ts        # Заказы: polling из БД, API actions, парковка
│   ├── useIngredients.ts   # CRUD ингредиентов через API
│   ├── useStopList.ts      # Стоп-лист: API toggle, каскад, история из БД
│   └── useAuth.ts          # Авторизация по PIN + localStorage-сессия
├── components/
│   ├── Navigation.tsx      # Навигация: вкладки по роли + юзер + Выйти
│   ├── LoginScreen.tsx     # Экран ввода PIN (numpad, авто-submit на 4-й цифре)
│   ├── SlicerStation.tsx   # KDS Board: сортировка, парковка, история
│   ├── OrderCard.tsx       # Карточка заказа: таймер, scroll-to-accept
│   ├── StopListManager.tsx # Стоп-лист: иерархия ингредиентов + CRUD
│   ├── StopReasonModal.tsx # Модалка причины стопа
│   ├── PartialCompletionModal.tsx # Numpad для частичного выполнения
│   ├── DefrostRow.tsx      # Ряд мини-карточек размораживающихся блюд (миграция 016)
│   ├── DefrostModal.tsx    # Модалка подтверждения «Разморозилась» — обёртка OrderCard с другой подписью кнопки
│   ├── AdminPanel.tsx      # Админ: категории, рецепты, настройки
│   ├── Dashboard.tsx       # Аналитика: стопы, скорость, расход
│   ├── admin/              # Вкладки админки
│   │   ├── CategoriesTab.tsx    # CRUD категорий
│   │   ├── CategoryRanking.tsx  # Порядок правил сортировки
│   │   ├── RecipeEditor.tsx     # Редактор рецептов (блюдо→ингредиенты)
│   │   └── SystemSettingsTab.tsx # Системные настройки
│   ├── dashboard/          # Секции Dashboard
│   │   ├── SpeedKpiSection.tsx       # KPI скорости приготовления нарезчика
│   │   ├── ChefCookingSpeedSection.tsx # Скорость готовки повара (finished_at → cooktime)
│   │   ├── IngredientUsageSection.tsx # Расход ингредиентов
│   │   ├── StopListHistorySection.tsx # История стоп-листа
│   │   └── dashboardUtils.ts         # Утилиты: businessOverlap, formatDate
│   └── ui/
│       └── ConfirmModal.tsx # Универсальная модалка подтверждения
├── server/                 # Backend (Express + PostgreSQL)
│   ├── package.json        # Зависимости: express, pg, cors, dotenv
│   ├── tsconfig.json       # TS config для сервера
│   ├── .env                # DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
│   ├── src/
│   │   ├── index.ts        # Express app, порт 3001
│   │   ├── config/
│   │   │   └── db.ts       # pg.Pool подключение к arclient
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /api/auth/login — проверка PIN по чужой users+userroles+roles
│   │   │   ├── orders.ts       # GET/POST заказы, complete, park, unpark
│   │   │   ├── ingredients.ts  # CRUD ингредиентов
│   │   │   ├── categories.ts   # CRUD категорий + reorder
│   │   │   ├── settings.ts     # GET/PUT настроек
│   │   │   ├── stoplist.ts     # Toggle стоп-лист + история
│   │   │   ├── recipes.ts      # GET/PUT рецептов
│   │   │   ├── dishes.ts       # GET блюд из ctlg15_dishes + upload/delete фото (multer)
│   │   │   └── history.ts      # История заказов + Dashboard аналитика
│   │   └── middleware/
│   │       └── errorHandler.ts # Обработчик ошибок
│   ├── public/
│   │   └── images/
│   │       ├── dishes/         # Фото блюд (multer → slicer_dish_images, миграция 008)
│   │       └── ingredients/    # Фото ингредиентов (multer → slicer_ingredients.image_url, миграция 009)
│   └── migrations/
│       ├── 001_create_slicer_tables.sql  # Создание базовых slicer-таблиц
│       ├── 002_seed_defaults.sql         # Начальные данные (категории, настройки)
│       ├── 003_dish_aliases.sql          # slicer_dish_aliases
│       ├── 004_dish_categories.sql       # slicer_dish_categories
│       ├── 005_dish_stoplist.sql         # slicer_dish_stoplist (каскадный стоп)
│       ├── 006_kds_stoplist_sync.sql     # двусторонняя синхронизация с rgst3 (OFF по умолчанию)
│       ├── 007_slicer_finished_at.sql    # slicer_order_state.finished_at для метрики повара
│       ├── 008_dish_images.sql           # slicer_dish_images (путь до файла на диске)
│       ├── 009_ingredient_images_filesystem.sql  # фото ингредиентов → на диск, image_url теперь путь
│       ├── 010_ingredient_buffer_percent.sql     # slicer_ingredients.buffer_percent для брутто в Dashboard
│       ├── 011_rgst3_archive_trigger.sql         # BEFORE DELETE триггер → архив снятых стопов кассира
│       ├── 012_rgst3_archive_with_code.sql       # target_name = "<code> <name>" + UPDATE старых записей
│       ├── 013_dish_priority.sql                 # slicer_dish_priority (NORMAL/ULTRA per-dish)
│       ├── 014_stop_actor_tracking.sql           # stopped_by_*/resumed_by_*/actor_source в slicer_stop_history и _dish_stoplist
│       ├── 015_rgst3_archive_with_actor.sql      # триггер пишет stopped_by_* из users по OLD.inserter
│       ├── 016_dish_defrost.sql                  # разморозка: slicer_dish_defrost + defrost_duration/sound в settings + defrost_* в order_state
│       ├── 017_dessert_auto_park.sql              # авто-парковка десертов: dessert_category_id + dessert_auto_park_enabled/minutes в settings
│       ├── 018_effective_created_at.sql           # Вариант Б парковки: effective_created_at + parked_by_auto, меняет семантику accumulated_time_ms
│       ├── 019_dessert_modifier_trigger.sql       # авто-парковка десертов только при наличии модификатора "Готовить%/Ждать%" (ctlg20)
│       └── 020_per_dish_defrost_duration.sql      # per-dish время разморозки в slicer_dish_defrost; удаление глобального defrost_duration_minutes из settings
├── BD_docs/                # Документация БД для программистов
│   ├── README.md           # Обзор архитектуры, ER-схема
│   ├── mappings.md         # TypeScript ↔ DB маппинг
│   ├── existing_tables.md  # Документация таблиц KDS
│   ├── tables/             # Документация каждой slicer_ таблицы
│   └── migrations/         # Описание миграций
└── public/images/          # Статические изображения
```

## Архитектура

### Управление состоянием
- **Хуки + API** — данные загружаются из PostgreSQL через REST API (`api/` → `server/`)
- **Polling** — `useOrders` опрашивает `GET /api/orders` каждые 4 секунды
- **Оптимистичные обновления** — UI обновляется сразу, потом синхронизируется с БД
- **Нет Redux/Zustand** — состояние в хуках, prop drilling
- **Основные state-переменные:**
  - `orders: Order[]` — активные заказы (polling из docm2_orders + slicer_order_state)
  - `dishes: Dish[]` — справочник блюд (из ctlg15_dishes)
  - `categories: Category[]` — категории (из slicer_categories)
  - `ingredients: IngredientBase[]` — ингредиенты (из slicer_ingredients)
  - `settings: SystemSettings` — настройки (из slicer_settings)
  - `stopHistory: StopHistoryEntry[]` — история стопов (из slicer_stop_history)
  - `orderHistory: OrderHistoryEntry[]` — история заказов (из slicer_order_history)

### Ключевые паттерны

1. **Smart Stacking (Умное объединение заказов)**
   - `quantity_stack: number[]` + `table_stack: number[][]`
   - Незмерженные стеки: `[2, 1]` → нужно нажать Merge до Done
   - Змерженные: `[3]` → можно нажать Done
   - Агрегация по: (1) тому же столу, (2) временному окну

2. **Иерархия ингредиентов + каскадный стоп блюд**
   - Двухуровневая иерархия: Parent (Potatoes) → Children (Raw Potato, Mashed...)
   - `parentId` поле в `IngredientBase`
   - Стоп родителя каскадирует на все children
   - **Каскадная логика живёт на backend** (`server/src/routes/stoplist.ts`, функция `recalculateCascadeStops`). После любого `POST /api/stoplist/toggle` ингредиента в той же транзакции:
     - Вычисляется целевой набор блюд, которые должны быть на каскадном стопе (с учётом parent-hierarchy + алиасов блюд)
     - Разница с текущими `CASCADE`-строками в `slicer_dish_stoplist` применяется через `DELETE` (с записью в `slicer_stop_history`) + `INSERT ON CONFLICT DO NOTHING`
     - MANUAL-стопы никогда не перезаписываются каскадом
   - Фронтенд `useStopList.ts` не содержит каскадной логики — после toggle он только вызывает `reloadDishes()` + `reloadIngredients()` чтобы подхватить изменения из БД
   - **Стоп-лист блюд = UNION двух источников** в `GET /api/dishes`: `rgst3_dishstoplist` (чужая KDS, read-only) + `slicer_dish_stoplist` (наш модуль). Причина `slicer_dish_stoplist` (Missing: X или Manual) имеет приоритет над пустым reason из `rgst3`.

3. **Парковка столов (Вариант Б — миграция 018)**
   - Table parking = откладывание заказов с таймером возврата. Split не реализован: парковка переводит ВЕСЬ заказ в `status='PARKED'`, `parked_tables` = дедуплицированный `table_stack.flat()`.
   - **Семантика `accumulated_time_ms`** (ИЗМЕНЕНА 018): теперь «общее время парковок», накопление происходит при `/unpark`, а не при `/park`. Формула таймера на клиенте — `elapsed = (pivot - created_at) - accumulated_time_ms`, где `pivot = parked_at` если PARKED (замирание), иначе `now`.
   - **Разделение ручной / авто парковки через `parked_by_auto`:**
     - Ручной `/park`: `parked_by_auto=FALSE`, `accumulated_time_ms` не трогаем. Ручной `/unpark`: `accumulated_time_ms += (NOW() - parked_at)`, `effective_created_at` не трогаем → заказ возвращается на историческое место в очереди (сортировка COURSE_FIFO по ordertime).
     - Авто-парковка десерта (в GET): `parked_by_auto=TRUE`. Авто-разпарковка (`unpark_at<=NOW()` в GET): `accumulated_time_ms=0`, `effective_created_at=unpark_at` → десерт «как новый», встаёт в конец очереди.
     - Ручной `/unpark` авто-припаркованного (гость сказал «несите уже»): `accumulated_time_ms=0`, `effective_created_at=NOW()` → десерт «как новый сейчас», в конец очереди.
   - `GET /api/orders` отдаёт `created_at = COALESCE(state.effective_created_at, items.docm2tabl1_ordertime)` — одно поле используется и для таймера, и для сортировки.
   - `parked_tables: number[]` — гранулярный трекинг каких столов паркованы (накопительно за время смены).
   - `parked_by_auto?: boolean` в Order — признак текущей активной парковки. Используется оптимистично при `/unpark` на фронте чтобы предугадать какая ветка логики сработает на backend.
   - **UI панели парковки**: если на одном столе позиции с разным `unpark_at` (ручная парковка супа + авто-парковка десерта), заголовок стола показывает диапазон `12:30–12:40 (разное время)`, а возле каждой позиции — бейдж с конкретным временем возврата.

4. **Scroll-to-Accept (OrderCard)**
   - Если >5 ингредиентов → кнопка Done заблокирована
   - Разблокируется только при прокрутке до конца списка
   - Предотвращает случайное завершение без просмотра всех компонентов

5. **Алиасы блюд (Dish Aliases) — общий рецепт для вариантов**
   - В чужой БД одно логическое блюдо имеет несколько вариантов: `163 Баклажаны` (зал) и `Д163 Баклажаны` (доставка, префикс `Д`)
   - Для нарезчика это одно и то же блюдо — режет одинаково, нужен один рецепт
   - Решение: таблица `slicer_dish_aliases (alias_dish_id PK → primary_dish_id)`
   - **Резолв на backend**: в `GET /api/orders` через `COALESCE(alias.primary_dish_id, dish_id)` подменяется `dish_id` → фронтенд получает заказы как будто алиасов не существует
   - В `GET /api/dishes` возвращается `recipe_source_id` — откуда брать рецепт (primary или сам suuid)
   - **Автокопия категорий**: `POST /api/dish-aliases` в одной транзакции копирует `category_ids` primary → alias (через `slicer_dish_categories`), чтобы alias сразу попадал в те же волны очереди, что и primary
   - **Канонизация в smartQueue**: `flattenOrders` использует `canonicalDishId = rawDish.recipe_source_id || rawDish.id`. Резолв на бэке `/api/orders` уже подменяет dish_id на primary, поэтому на реальных заказах это no-op. Сохранено как защита на случай, если когда-нибудь в `dishes` state попадёт алиасный id. `SlicerStation.tsx`, `useOrders.ts` — не знают об алиасах
   - Ограничение: `alias_dish_id` — PK → одно блюдо = один рецепт
   - Управление через UI в `RecipeEditor.tsx` (кнопка "Связать" на карточке блюда)

6. **Ручное назначение категорий блюдам (slicer_dish_categories)**
   - Чужая `ctlg15_dishes.ctlg15_ctlg38_uuid__goodcategory` не маппится на slicer-категории напрямую
   - Решение: таблица `slicer_dish_categories (dish_id, category_id, PK(...))` — нарезчик сам назначает категорию блюду через UI «Рецепты»
   - `GET /api/dishes` собирает `category_ids` через `array_agg(category_id)` по dish_id; блюда без назначения попадают в секцию «Без категории» в `RecipeEditor.tsx`
   - `PUT /api/dishes/:dishId/categories` — полная замена назначений в транзакции
   - `saveDishForm` в `RecipeEditor` сохраняет назначения через этот endpoint, рецепт — через `PUT /api/recipes/:dishId` (для alias-блюда dishId резолвится в primary через `aliasMap` перед отправкой). Источник правды после save — БД, `setDishes` руками больше не обновляется, вызывается `onRefreshDishes()`
   - **Блюда без slicer-категории не попадают на доску.** Семантика: "если нарезчик не настроил категорию через UI — значит блюдо готовое (рис отварной, пампушки) и не проходит через нарезчика, отдаётся сразу на раздаче". Реализация: `GET /api/orders` фильтрует через `EXISTS slicer_dish_categories` по каноническому dish_id (после резолва алиаса). В `smartQueue.flattenOrders` дублирующая защита: если `getPrimaryCategory` вернул null — позиция пропускается. `UNCATEGORIZED_CATEGORY` fallback удалён. Новые блюда меню появляются редко, настраиваются вручную в RecipeEditor (секция "Без категории" служит todo-листом)

7. **Фильтр цехов (Storage Filter) — whitelist**
   - Нарезчик видит только кухонные блюда. Бар, хозка, битые ссылки — скрываются
   - **Whitelist-подход**: показываем только позиции/блюда с UUID кухонного склада
   - Константа `KITCHEN_STORAGE_UUIDS` в двух синхронизированных местах:
     - `server/src/routes/orders.ts` — фильтр `GET /api/orders`
     - `server/src/routes/dishes.ts` — фильтр `GET /api/dishes`
   - Два источника данных для `/api/dishes` (OR-условие):
     1. **`ctlg18_menuitems`** — меню ресторана (новые блюда появляются сразу)
     2. **`docm2tabl1_items`** — историческая выборка (fallback)
   - Связь: `docm2tabl1_items.docm2tabl1_ctlg17_uuid__storage` → `ctlg17_storages.suuid`
   - При деплое на другой ресторан — обновить UUID кухни под целевую БД

8. **COURSE_FIFO (Гибридная сортировка)**
   - Заказы группируются по временным окнам (`courseWindowSeconds`, дефолт: 300с = 5мин)
   - Внутри окна — по категории (суп → салат → горячее → десерт)
   - Между окнами — строго FIFO (новые заказы не обгоняют старые)
   - `SortRuleType: 'ULTRA' | 'FIFO' | 'CATEGORY' | 'COURSE_FIFO'`
   - Default: `activePriorityRules: ['ULTRA', 'COURSE_FIFO']`

9. **Авторизация по PIN из чужой таблицы `users`**
   - Модуль закрыт `LoginScreen`. PIN — 4-значный integer из `users.pin` заказчика.
   - Backend `POST /api/auth/login` делает `SELECT u.uuid, u.login, r.name AS role FROM users u LEFT JOIN userroles ur ON ur.user_uuid=u.uuid LEFT JOIN roles r ON r.uuid=ur.role_uuid WHERE u.pin=$1 AND u.locked=false AND u.pin>0`. Возвращает `{uuid, login, roles: string[]}`.
   - Фронт хранит сессию в `localStorage` (ключ `slicer_auth_user`). F5 не разлогинивает. Автовыхода нет — только ручной «Выйти» (по требованию заказчика).
   - **Матрица роль→вкладки** в `constants.ts` → `ROLE_ACCESS`:
     - `admin`, `Администратор`, `Заведующий производством` → все 4 вкладки
     - `Официант` → только `KDS` (Очередь)
     - `Просмотр отчётов` → только `DASHBOARD`
     - `Кухня`, `Хостес`, `Кассир` → пустой массив (экран «Нет доступа» + кнопка Выйти)
   - `getAllowedViews(roles)` объединяет права всех ролей юзера (у одного может быть несколько через `userroles`).
   - `Navigation.tsx` фильтрует вкладки по `allowedViews`; `App.tsx` на `useEffect` переключает `currentView` если текущая вкладка недоступна новому юзеру.
   - **Защита только клиентская** — backend НЕ проверяет роль на write-endpoints. Это требование заказчика (кухонный планшет, не production-grade auth). Если когда-нибудь понадобится — добавить middleware в `server/src/middleware/` + передавать user_uuid в заголовке.

10. **Отслеживание актора стопов (кто поставил / кто снял)**
    - Миграция 014: добавлены колонки `stopped_by_uuid`, `stopped_by_name`, `resumed_by_uuid`, `resumed_by_name`, `actor_source` в `slicer_stop_history`; `stopped_by_*` + `actor_source` в `slicer_dish_stoplist`; `stopped_by_*` в `slicer_ingredients`.
    - `actor_source`: `'slicer'` (наш модуль), `'kds'` (основная KDS), `'cascade'` (автоматический каскад от ингредиента).
    - **Источник 1 — slicer:** фронт передаёт `actorUuid` + `actorName` (из `useAuth`) в `POST /api/stoplist/toggle`. Backend пишет в state (ingredients/dish_stoplist) при постановке и переносит в `slicer_stop_history` при снятии (плюс `resumed_by_*` из actor'а снимающего).
    - **Источник 2 — kds (живые rgst3-стопы, архив закрытых смен):** `GET /api/stoplist/history` делает `LEFT JOIN users ON u.uuid::text = r.inserter` — резолвит актора прямо из чужой `rgst3.inserter`. Работает без триггера.
    - **Источник 3 — kds через DELETE:** триггер `slicer_archive_rgst3_delete` (миграция 015) при удалении rgst3-строки резолвит `OLD.inserter` через `users`, пишет `stopped_by_*` + `actor_source='kds'`. `resumed_by_*` остаются NULL — rgst3 не хранит кто именно нажал «снять».
    - **Источник 4 — cascade:** `recalculateCascadeStops(client, actor)` в `server/src/routes/stoplist.ts` принимает actor'а triggering-toggle и копирует его в новые CASCADE-строки `slicer_dish_stoplist`. Имя ингредиента-родителя caлится в `reason` как раньше (`Missing: <ingredient>`).
    - **Старые записи (до миграции 014):** все `actor_*` = NULL, ретро-заполнение не делаем. UI показывает «—».
    - **UI:** в `StopListHistorySection.tsx` компонент `<ActorLine>` рендерит «Поставил: X · Снял: Y» под time range в развёрнутых детальных строках обоих режимов группировки (by-item / by-date). Бейджи `[KDS]` / `[каскад]` подсказывают источник.

11. **Разморозка блюд (миграции 016 + 020)**
    - Для замороженных блюд (изначально рыба, дальше по ситуации): в `RecipeEditor` выставляется флаг «Требует разморозки? Да/Нет» (по умолчанию Нет) + per-dish время таймера в минутах (1..60, default 15). Оба значения пишутся в `slicer_dish_defrost` (`requires_defrost`, `defrost_duration_minutes`) **на primary-блюдо** (alias наследует через `recipe_source_id` — тот же паттерн что рецепт). Поле минут показывается только когда выбрано «Да».
    - **Глобальная настройка `slicer_settings.defrost_duration_minutes` удалена миграцией 020** — время стало per-dish. В `slicer_settings` остался только `enable_defrost_sound`. `POST /api/orders/:id/defrost-start` резолвит длительность через JOIN alias→primary→`slicer_dish_defrost`, COALESCE 15 мин. `useOrders.handleStartDefrost` оптимистично берёт duration из `dishMap`. `slicer_order_state.defrost_duration_seconds` — snapshot в момент клика, остаётся как был.
    - **Три состояния карточки:**
      - **Ожидание** (`defrost_started_at IS NULL`): карточка в очереди, в правом верхнем углу кликабельная синяя ❄️ с pulse.
      - **В процессе** (`started AND now < started + duration*sec`): карточка **не отрисовывается** в основной очереди (в `smartQueue.flattenOrders` стоит фильтр `isDefrostActive(order) → continue`), а показывается мини-карточкой в `DefrostRow` над сеткой. Мини-карточка: ❄️ + код блюда + Nшт + столы + обратный таймер + [×] для отмены.
      - **Разморожено** (`started AND now >= started + duration*sec`): карточка снова в очереди на том же месте по `created_at` (COURSE_FIFO). ULTRA-приоритет сохраняется — раз блюдо было ULTRA, оно остаётся ULTRA и после разморозки. В правом верхнем — статичная серая ❄️ как индикатор «уже размораживалось» (для защиты от повторного запуска таймера, не для сортировки).
    - **Клик по мини-карточке** → `DefrostModal`: стандартный `<OrderCard>` целиком, только `completeButtonLabel="РАЗМОРОЗИЛАСЬ"` + `onCompleteOrder` → `defrost-complete`. Крестик [×] на самой мини-карточке отменяет без модалки.
    - **«Разморозилась» (ручное подтверждение)** бэкдейтит `defrost_started_at = NOW() - (duration+1)s` → таймер «истёк», карточка возвращается в очередь. Отдельной колонки `defrost_completed_at` не вводили — состояние однозначно выражается парой started_at/duration.
    - **Smart Wave group**: в `SlicerStation` defrosting orders группируются по `(dish_id + started_at mod 5s)` → одна мини-карточка на «вспышку» (3 стола одной рыбы = одна карточка с агрегированным кол-вом/столами). Резолв виртуального id → `sourceOrderItemIds[]` через inline mapping; бэкенд апдейтит все items одной транзакцией.
    - **Разделение агрегации по defrost-статусу**: в основной очереди `smartQueue.groupItemsByDish` группирует по паре `(dishId + wasDefrosted)`, а не просто по `dishId`. Уже размороженные (таймер истёк → вернулись в очередь) и свежие порции одного блюда идут в РАЗНЫЕ виртуальные карточки. Это защита от перезапуска разморозки: без этого клик ❄️ на объединённой карточке вызывал `defrost-start` на всех source-ах и стартовал 15-минутный таймер на уже готовой рыбе. Флаг `wasDefrosted = hasDefrostBeenStarted(order)` копируется в `FlatOrderItem` в `flattenOrders` и в `SmartQueueGroup`. В `SlicerStation` virtualOrder защищённой группы наследует `defrost_started_at/duration_seconds` с одного из source-ов — `OrderCard` видит `hasDefrostBeenStarted=true`, рисует серую ❄️-индикацию и скрывает кнопку запуска. На ULTRA-приоритет и сортировку этот флаг **не влияет**.
    - **Сброс defrost-state** при: park (парковка доминирует), restore (восстановленный заказ → чистый лист), defrost-cancel (отмена вручную). complete/cancel — удалять поля не надо, ряд всё равно уходит.
    - **Звук**: при истечении таймера мини-карточки играется Web Audio beep (3-тональный, ~0.5 сек). Флаг `slicer_settings.enable_defrost_sound` (default TRUE). Трекинг «уже отыграл» живёт в ref внутри `DefrostRow` — не повторяется каждую секунду.

12. **Авто-парковка десертов (миграции 017 + 019)**
    - Проблема: десерты в чеке сразу вместе с салатом/горячим, но часто их нужно готовить через 30–40 мин (гости сами сигналят). Без правила карточка десерта падает в очередь и сбивает FIFO. Но иногда десерт хотят «сразу» — правило не должно срабатывать на всех подряд.
    - Решение (017): при первом появлении дессертной позиции в `GET /api/orders` backend INSERT'ит `slicer_order_state` со `status=PARKED`, `parked_at=docm2tabl1_ordertime`, `unpark_at=ordertime + X min`, `was_parked=true`. Авто-разпарковка в том же маршруте (блок выше, `unpark_at <= NOW()`) снимет парковку когда время подойдёт.
    - **Триггер через модификатор (019)**: правило срабатывает ТОЛЬКО если у позиции есть модификатор из `ctlg20_modifiers`, чьё имя матчит один из паттернов в `slicer_settings.dessert_trigger_modifier_patterns` (default `{Готовить%, Ждать%}`). Связка через `docm2tabl2_dishmodifiers.docm2tabl2_itemrow = docm2tabl1_items.suuid`. Без такого модификатора десерт идёт в очередь сразу, как обычное блюдо.
    - **Время возврата из модификатора**: если имя модификатора вида `"Готовить к HH.MM"` (парсится regex `к\s*(\d{1,2})[.:](\d{2})`) → парковка до сегодняшних HH:MM. Если несколько таких у одной позиции — берётся MAX (консервативно). Если модификатор без времени (`"Готовить позже"`, `"Ждать разъяснений"`) → парковка на `dessert_auto_park_minutes` (default 40) от ordertime.
    - Настройки в `slicer_settings`: `dessert_category_id` (UUID, FK→slicer_categories ON DELETE SET NULL), `dessert_auto_park_enabled` (bool, default false), `dessert_auto_park_minutes` (int 1..240, default 40), `dessert_trigger_modifier_patterns` (TEXT[], default `{Готовить%, Ждать%}`). Seed привязывает `dessert_category_id` к категории «Десерты» по имени.
    - UI: тумблер ВКЛ/ВЫКЛ + input минут живут на карточке дессертной категории в `CategoriesTab`. Паттерны модификаторов правятся напрямую в БД через SQL (UI не предусмотрен — изменения редкие).
    - Защита от удаления: `DELETE /api/categories/:id` отдаёт 409 если id совпадает с `dessert_category_id`. В UI кнопка корзины скрыта + бейдж 🔒 «Системная категория». FK `ON DELETE SET NULL` — страховка на уровне БД.
    - `ON CONFLICT (order_item_id) DO NOTHING` — если нарезчик вручную вернул десерт раньше времени, мы его не паркуем повторно. Правило срабатывает только при **первом** появлении позиции в запросе.

## Навигация (ViewMode)
| Mode | Компонент | Описание |
|---|---|---|
| `KDS` | `SlicerStation` | Основная доска заказов |
| `STOPLIST` | `StopListManager` | Управление стоп-листом |
| `ADMIN` | `AdminPanel` | Администрирование |
| `DASHBOARD` | `Dashboard` | Отчёты и аналитика |

## Важные константы
- **Порт** dev-сервера: `3000` (файл `vite.config.ts`)
- **Окно агрегации** по умолчанию: `5 минут`
- **Окно COURSE_FIFO** по умолчанию: `300 секунд` (5 мин)
- **Удержание истории** по умолчанию: `60 минут`

## Стилизация
- **TailwindCSS через CDN** (глобальный `tailwind.config` в `<script>` тэге `index.html`)
- **Кастомные цвета:** `kds-bg`, `kds-card`, `kds-header`, `kds-accent`, `kds-ultra`, `kds-vip`, `kds-success`
- **Кастомные тени:** `glow-red`, `glow-orange`, `glow-green`
- **Тёмная тема** только (нет переключателя)

## Команды
```bash
# Frontend
npm install       # Установка зависимостей фронтенда
npm run dev       # Dev-сервер (порт 3000, proxy /api → 3001)
npm run build     # Production сборка
npm run typecheck # Проверка типов (tsc --noEmit)
npm run lint      # Линтинг (ESLint)

# Backend
cd server && npm install  # Установка зависимостей сервера
cd server && npm run dev  # Dev-сервер (порт 3001, hot-reload)

# Миграции БД
cd server && psql -U postgres -d arclient -f migrations/001_create_slicer_tables.sql
cd server && psql -U postgres -d arclient -f migrations/002_seed_defaults.sql
```

## База данных (PostgreSQL)

### Подключение
- **БД:** `arclient` на `localhost:5432`
- **Пользователь:** `postgres` / `1234`
- **Backend сервер:** Express на порту `3001`
- **Vite proxy:** `/api` → `localhost:3001`

### Существующие таблицы KDS (ТОЛЬКО ЧТЕНИЕ + запись cooked):
| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `docm2_orders` | Заказы | suuid, docm2_ctlg13_uuid__halltable, docm2_opentime |
| `docm2tabl1_items` | Позиции заказа | suuid, owner(→orders), docm2tabl1_ctlg15_uuid__dish, docm2tabl1_quantity, docm2tabl1_cooked |
| `ctlg15_dishes` | Блюда | suuid, name, ctlg15_ctlg38_uuid__goodcategory |
| `ctlg13_halltables` | Столы | suuid, ctlg13_tablenumber |
| `ctlg14_shifts` | Смены | suuid, ctlg14_closed |
| `ctlg18_menuitems` | Меню (блюдо↔склад) | ctlg18_ctlg15_uuid__dish, ctlg18_ctlg17_uuid__storage |
| `ctlg17_storages` | Склады-цеха | suuid, name (whitelist: только Кухня) |
| `rgst3_dishstoplist` | Стоп-лист блюд | rgst3_ctlg15_uuid__dish |
| `users` | Пользователи заказчика | uuid, login, pin (4 цифры), locked — для авторизации модуля по PIN |
| `userroles` | Связь user ↔ роль (M2M) | user_uuid, role_uuid, bydefault |
| `roles` | Справочник ролей | uuid, name ('admin', 'Официант', 'Заведующий производством', ...) |

### Таблицы модуля нарезчика (prefix `slicer_`):
| Таблица | Назначение |
|---|---|
| `slicer_categories` | Категории с порядком сортировки |
| `slicer_dish_categories` | Ручное назначение slicer-категорий блюдам (dish_id → category_id) |
| `slicer_ingredients` | Справочник ингредиентов (parent→child, стоп-лист) |
| `slicer_recipes` | Рецепты: блюдо → ингредиент + граммовка |
| `slicer_dish_aliases` | Алиасы блюд: общий рецепт для вариантов (163/Д163) |
| `slicer_dish_stoplist` | Актуальный стоп-лист блюд модуля (MANUAL + CASCADE), + колонка `rgst3_row_suuid` для линковки с зеркальной строкой |
| `slicer_dish_images` | Фото блюд: путь до файла в `server/public/images/dishes/`. Загрузка через multer, раздача Express static + nginx. Миграция 008. |
| `slicer_dish_priority` | Приоритет отображения блюда (1=NORMAL, 3=ULTRA), per-dish. Отсутствие записи = NORMAL. Миграция 013. |
| `slicer_dish_defrost` | Per-dish флаг «требует разморозки?» + per-dish время таймера в минутах (`defrost_duration_minutes`, миграция 020). Хранится на primary; alias наследует через recipe_source_id. Миграции 016, 020. |
| `slicer_kds_sync_config` | Singleton-конфиг для двусторонней синхронизации с `rgst3_dishstoplist` (OFF по умолчанию) |
| `slicer_order_state` | Состояние заказов нарезчика (парковка, статус, finished_at для метрики повара, defrost_started_at/duration — миграция 016) |
| `slicer_order_history` | Завершённые заказы (KPI, snapshot) |
| `slicer_ingredient_consumption` | Расход ингредиентов (для отчётов) |
| `slicer_stop_history` | История стопов (для Dashboard %). Миграция 014 добавила `stopped_by_*` / `resumed_by_*` / `actor_source` — кто поставил и кто снял |
| `slicer_settings` | Настройки модуля (singleton) |

### ⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА работы с БД

1. **Каждое изменение схемы БД** ОБЯЗАНО быть задокументировано в `BD_docs/`:
   - Новая таблица → `BD_docs/tables/<table_name>.md`
   - Новая миграция → `BD_docs/migrations/<NNN>_<description>.md`
   - Изменение связей → `BD_docs/relations.md`
   - Изменение маппинга → `BD_docs/mappings.md`

2. **Формат документации таблицы** (`BD_docs/tables/*.md`):
   - Название и назначение таблицы (на русском)
   - Список колонок: имя, тип, NOT NULL, DEFAULT, описание
   - Индексы и Foreign Keys
   - Связанные таблицы (какие JOIN используются)
   - Пример INSERT и SELECT запросов
   - Метод связывания (по какому полю и зачем)

3. **Это нужно** чтобы программист мог воспроизвести всё на продакшн-системе без ошибок.

4. **Префикс `slicer_`** — все новые таблицы модуля нарезчика ОБЯЗАНЫ начинаться с этого префикса.

5. **Не трогать структуру** существующих таблиц KDS (`docm2_*`, `ctlg*`, `rgst*`). По умолчанию модуль вообще не пишет в чужие таблицы. Два исключения:
   - `rgst3_dishstoplist` INSERT/DELETE при включённой двусторонней синхронизации (раздел 10 Инструкции). OFF по умолчанию.
   - BEFORE DELETE триггер `slicer_archive_rgst3_delete_trg` на `rgst3_dishstoplist` (миграция 011) — не меняет схему, не блокирует DELETE, только копирует OLD row в slicer_stop_history. Нужен для полноты аналитики: без него снятия стопов кассиром в течение смены теряются (rgst3 удаляет row безвозвратно).

## Структура Backend

```
server/
  src/
    index.ts              — Express app, порт 3001
    config/db.ts          — pg.Pool подключение к arclient
    routes/               — REST API маршруты
    services/             — Бизнес-логика, маппинг
    middleware/            — Обработка ошибок
    migrations/           — SQL миграции
```

## API Endpoints
- `POST /api/auth/login` — авторизация по PIN. Body: `{pin: number}` (4 цифры). Возвращает `{uuid, login, roles}` или 401.
- `GET /api/orders` — активные заказы (polling каждые 4 сек)
- `POST /api/orders/:id/complete` — завершить заказ
- `POST /api/orders/:id/partial-complete` — частичное завершение
- `POST /api/orders/:id/restore` — вернуть из истории (UPSERT slicer_order_state: status=ACTIVE, quantity_stack, table_stack, finished_at=NULL). Используется `handleRestoreOrder` — без него локальное оптимистичное восстановление перетиралось polling'ом через 4 сек.
- `POST /api/orders/:id/park` — парковка стола
- `POST /api/orders/:id/unpark` — снять с парковки
- `POST /api/orders/:id/merge` — объединить стеки
- `POST /api/orders/:id/cancel` — отменить заказ
- `GET /api/dishes` — справочник блюд (из ctlg15_dishes, с recipe_source_id)
- `PUT /api/dishes/:dishId/categories` — назначить блюду slicer-категории (полная замена)
- `PUT /api/dishes/:dishId/priority` — назначить приоритет блюда (1=NORMAL, 3=ULTRA), UPSERT в `slicer_dish_priority`
- `PUT /api/dishes/:dishId/defrost` — назначить флаг «требует разморозки?» и per-dish время в минутах (UPSERT в `slicer_dish_defrost`, миграция 020). Body `{requires_defrost, defrost_duration_minutes?}`. RecipeEditor перед вызовом резолвит dishId в primary через aliasMap.
- `POST /api/orders/:id/defrost-start` — запустить таймер разморозки. Body `{sourceOrderItemIds?}`. Snapshot duration читается per-dish из `slicer_dish_defrost` (JOIN alias→primary, COALESCE 15), UPSERT в `slicer_order_state` для всех items атомарно (Smart Wave: один клик → N items).
- `POST /api/orders/:id/defrost-cancel` — сбросить `defrost_started_at/duration` в NULL → карточка возвращается в очередь.
- `POST /api/orders/:id/defrost-complete` — ручное подтверждение «Разморозилась»: бэкдейтит `defrost_started_at` на `(duration+1) sec` назад → таймер «истёк», карточка возвращается в очередь.
- `POST /api/dishes/:dishId/image` — загрузить фото блюда (multipart/form-data, поле `image`, до 5МБ, image/jpeg|png|gif|webp). Файл кладётся в `server/public/images/dishes/<id>.<ext>`, путь — в `slicer_dish_images`.
- `DELETE /api/dishes/:dishId/image` — удалить фото блюда (файл с диска + запись в `slicer_dish_images`).
- `POST /api/ingredients/:id/image` — загрузить фото ингредиента (multipart, 5МБ, image/*). Файл → `server/public/images/ingredients/<id>.<ext>`, путь — в `slicer_ingredients.image_url` (миграция 009, раньше там хранился Base64).
- `DELETE /api/ingredients/:id/image` — удалить фото ингредиента (файл + очистка image_url).
- `GET /api/dish-aliases`, `POST /api/dish-aliases` — алиасы блюд (общий рецепт для вариантов)
- `DELETE /api/dish-aliases/:alias_dish_id` — отвязать алиас
- `GET/POST/PUT/DELETE /api/ingredients` — CRUD ингредиентов
- `GET/POST/PUT/DELETE /api/categories` — CRUD категорий
- `PUT /api/categories/reorder` — пакетная смена порядка
- `GET/PUT /api/recipes/:dishId` — рецепты
- `GET/PUT /api/settings` — настройки
- `POST /api/stoplist/toggle` — стоп-лист
- `GET /api/stoplist/history` — история стопов
- `GET /api/history/orders` — история завершённых заказов
- `GET /api/history/dashboard/speed-kpi` — KPI скорости (нарезчик)
- `GET /api/history/dashboard/chef-cooking-speed` — метрика «Скорость готовки повара» (`docm2tabl1_cooktime - slicer_order_state.finished_at`). Сырые записи, агрегация на клиенте
- `GET /api/history/dashboard/ingredient-usage` — расход ингредиентов
- `GET /api/health` — проверка здоровья сервера

## Важные Notes для AI

1. **Backend:** Express + pg на порту 3001, proxy через Vite
2. **Тесты отсутствуют** — нет тестового фреймворка
3. **Изображения:** часть через Unsplash URL, часть через локальные `/images/`, часть Base64
4. **Strict Mode включён** — компоненты рендерятся дважды в dev, побочные эффекты написаны с учётом этого
5. **Все handler-функции** определены в хуках (`hooks/`) и передаются через props
6. **Оптимистичные обновления** — UI обновляется сразу, при ошибке API откатывается через `reload*()` из БД
7. **API-клиент** — все запросы к backend через `services/client.ts` (fetch wrapper с JSON и error handling)
8. **Папка `services/`** (не `api/`) — названа так из-за конфликта с Vite proxy `/api`, который перехватывает все пути начинающиеся с `/api`
7. **ESLint** — используется flat config (`eslint.config.js`) с TS-парсером
8. **Polling заказов** — фронтенд опрашивает `GET /api/orders` каждые 4 секунды
9. **Авто-разпарковка** — backend проверяет `unpark_at <= NOW()` при каждом GET запросе
