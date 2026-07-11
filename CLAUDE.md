# CLAUDE.md — Контекст проекта для AI-агента

> Актуализирован 2026-07-12 по итогам аудита готовности к передаче (полные ревью кода — 2026-07-06 и 2026-07-11) + проверка отчётов/Excel того же дня: фикс таймзоны дат экспорта, свёрнутые группы, звук нового заказа (миграция 026). При изменении кода — обновляй этот файл (правило 2).

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
- **Опционально:** `INSERT/DELETE` в `rgst3_dishstoplist` через адаптер `server/src/services/kdsStoplistSync.ts`. Только если включен флаг `slicer_settings.enable_kds_stoplist_sync = true` (по умолчанию false). Это **единственное место** в коде, где модуль может трогать чужую таблицу для записи. Конфиг включения — `slicer_kds_sync_config` (вспомогательный SQL: `server/scripts/configure-kds-sync.sql`). См. `Инструкция.md` → раздел «Двусторонняя синхронизация стоп-листа».
  - **Политика mastership (с миграции 021):** при ручном снятии блюда со стопа в нашем UI модуль удаляет **все** строки `rgst3_dishstoplist` для этого блюда в текущей смене — включая поставленные кассиром. Семантика: «у нарезчика финальное слово по поводу что готовится». Каскадное снятие (через ингредиент) удаляет только нашу зеркальную строку — кассирские стопы не трогает.
  - Триггер `slicer_archive_rgst3_delete_trg` (миграции 011/015/021) определяет «наш DELETE» через линковку `slicer_dish_stoplist.rgst3_row_suuid` и пропускает архивацию для своих строк, чтобы избежать дублей в `slicer_stop_history`.

#### ⚠️ РАНЬШЕ ПИСАЛИ, ТЕПЕРЬ НЕТ: `docm2tabl1_items.docm2tabl1_cooked`
Модуль **НЕ** пишет в это поле (убрано в миграции 007, 2026-04-18). Причина: блюдо может отображаться на других панелях основной KDS (раздача, пасс, мобильное приложение официанта), и нажатие нарезчиком «Готово» путало их, давая ложный сигнал «готово всё блюдо». Нарезчик закрывает позицию **только** в своей теневой таблице: `slicer_order_state.status = 'COMPLETED'` + `slicer_order_state.finished_at = NOW()`. Поле `docm2tabl1_cooked` / `docm2tabl1_cooktime` остаётся под управлением основной KDS. Разница `docm2tabl1_cooktime - slicer_order_state.finished_at` = время готовки повара (используется в отчётах Dashboard, см. `Инструкция.md` раздел 11).

#### 🎯 Цель этого правила
Когда модуль передаётся заказчику, программисты должны:
1. Получить список миграций (SQL файлы из `server/migrations/`)
2. Выполнить их на своей продакшн-БД (есть готовый скрипт `cd server && npm run migrate`)
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
- **Стили:** TailwindCSS 4 через PostCSS (`tailwind.config.js` + `postcss.config.js` + `index.css`). ⚠️ CDN-вариант убран — конфига в `index.html` больше нет.
- **Иконки:** lucide-react
- **Графики:** recharts
- **Экспорт отчётов:** exceljs + file-saver (генерация .xlsx на клиенте, `services/excelExport.ts`)
- **Backend:** Express 4 + pg (node-postgres) + multer (загрузка фото), порт 3001
- **БД:** PostgreSQL 18 (arclient, localhost:5432)
- `@types/react` / `@types/react-dom` установлены (2026-07-06) — `npm run typecheck` теперь реально проверяет props компонентов.

## Структура файлов

```
/                           # Корень проекта
├── index.html              # Чистый HTML-шаблон (только #root + подключение index.tsx)
├── index.tsx               # React entry point (StrictMode, импорт index.css)
├── index.css               # Tailwind (@import "tailwindcss" + @config), фон, кастомный скроллбар
├── tailwind.config.js      # Tailwind: kds-цвета, glow-тени, шрифты
├── postcss.config.js       # PostCSS: @tailwindcss/postcss + autoprefixer
├── App.tsx                 # Корневой компонент: роутинг вьюшек, подключение хуков, дебаунс настроек
├── types.ts                # TypeScript типы: Order, Dish, Ingredient, Settings...
├── utils.ts                # Утилиты: generateId(), calculateConsumedIngredients(), playDefrostBeep(), playNewOrderBeep()
├── smartQueue.ts           # Два движка очереди: buildSmartQueue («Темп курсов») + buildSpeedQueue (режим скорости)
├── constants.ts            # ROLE_ACCESS + getAllowedViews (живое); INITIAL_* моки — легаси, нигде не импортируются
├── vite.config.ts          # Vite: порт 3000, host 0.0.0.0, proxy /api и /images → localhost:3001
│                           #   (define GEMINI_API_KEY — легаси от AI Studio скаффолда, кодом не используется)
├── tsconfig.json           # TS config: ES2022, react-jsx, bundler, allowJs (strict НЕ включён)
├── eslint.config.js        # ESLint flat config — ⚠️ сам eslint не установлен, npm run lint нерабочий
├── Инструкция.md           # Deliverable для IT-команды заказчика (развёртывание модуля)
├── Полная_инструкция_по_установке.txt  # Пошаговая установка с нуля
├── .env.local / .env.example  # Легаси от скаффолда (GEMINI_API_KEY), модулем не используются
├── services/               # Frontend API-клиент (fetch обёртки). Папка называется services, НЕ api
│   ├── client.ts           # Базовый fetch wrapper (/api → localhost:3001)
│   ├── authApi.ts          # Авторизация по PIN (POST /api/auth/login)
│   ├── ordersApi.ts        # Заказы: complete, park, unpark, merge, restore, defrost-*, история
│   ├── ingredientsApi.ts   # CRUD ингредиентов
│   ├── categoriesApi.ts    # CRUD категорий + reorder
│   ├── settingsApi.ts      # GET/PUT настроек
│   ├── stoplistApi.ts      # Toggle стоп-лист + история
│   ├── dishesApi.ts        # Загрузка блюд из ctlg15_dishes, категории/приоритет/defrost per-dish
│   ├── dishAliasesApi.ts   # Алиасы блюд: GET/POST /api/dish-aliases, DELETE отвязка
│   ├── recipesApi.ts       # GET/PUT рецептов
│   ├── chefCookingApi.ts   # Метрика «Скорость готовки повара» (Dashboard)
│   ├── dishImagesApi.ts    # Upload/delete фото блюда (multipart)
│   ├── ingredientImagesApi.ts # Upload/delete фото ингредиента (multipart)
│   └── excelExport.ts      # Экспорт сводки Dashboard в .xlsx (5 листов, ExcelJS + file-saver, всё на клиенте; даты через toExcelDate — компенсация TZ, группы свёрнуты по умолчанию)
├── hooks/
│   ├── useOrders.ts        # Заказы: polling из БД (4 сек), API actions, парковка, разморозка
│   ├── useIngredients.ts   # CRUD ингредиентов через API
│   ├── useStopList.ts      # Стоп-лист: API toggle, история из БД (каскад — на backend)
│   └── useAuth.ts          # Авторизация по PIN + localStorage-сессия
├── components/
│   ├── Navigation.tsx      # Навигация: вкладки по роли + юзер + Выйти
│   ├── LoginScreen.tsx     # Экран ввода PIN (numpad, авто-submit на 4-й цифре)
│   ├── SlicerStation.tsx   # KDS Board: очередь (Smart Wave / стандартная), парковка, история
│   ├── OrderCard.tsx       # Карточка заказа: таймер, scroll-to-accept, merge, ❄️
│   ├── StopListManager.tsx # Стоп-лист: иерархия ингредиентов + CRUD
│   ├── StopReasonModal.tsx # Модалка причины стопа
│   ├── PartialCompletionModal.tsx # Numpad для частичного выполнения
│   ├── DefrostRow.tsx      # Ряд мини-карточек размораживающихся блюд (миграция 016)
│   ├── DefrostModal.tsx    # Модалка «Разморозилась» — обёртка OrderCard с другой подписью кнопки
│   ├── AdminPanel.tsx      # Админ: категории, рецепты, настройки
│   ├── Dashboard.tsx       # Аналитика: стопы, скорость, расход + экспорт в Excel
│   ├── admin/              # Вкладки админки
│   │   ├── CategoriesTab.tsx    # CRUD категорий + тумблер авто-парковки десертов
│   │   ├── CategoryRanking.tsx  # Порядок правил сортировки + окно COURSE_FIFO (сек)
│   │   ├── RecipeEditor.tsx     # Редактор рецептов (блюдо→ингредиенты, алиасы, приоритет, разморозка)
│   │   └── SystemSettingsTab.tsx # Системные настройки (часы работы, история, звук, агрегация)
│   ├── dashboard/          # Секции Dashboard
│   │   ├── SpeedKpiSection.tsx       # KPI скорости приготовления нарезчика
│   │   ├── ChefCookingSpeedSection.tsx # Скорость готовки повара (finished_at → cooktime)
│   │   ├── IngredientUsageSection.tsx # Расход ингредиентов
│   │   ├── StopListHistorySection.tsx # История стоп-листа (фильтры, акторы, склады)
│   │   ├── MiniTimelineChart.tsx     # Мини-гистограмма «где просадка» (час/день/месяц)
│   │   └── dashboardUtils.ts         # Утилиты: calculateBusinessOverlap, formatDuration, mergeIntervals...
│   └── ui/
│       └── ConfirmModal.tsx # Универсальная модалка подтверждения
├── server/                 # Backend (Express + PostgreSQL)
│   ├── package.json        # express, pg, cors, dotenv, multer; скрипт npm run migrate (все миграции по порядку)
│   ├── tsconfig.json       # TS config для сервера
│   ├── .env                # DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
│   ├── scripts/
│   │   └── configure-kds-sync.sql    # Настройка двусторонней синхронизации rgst3 (opt-in)
│   ├── src/
│   │   ├── index.ts        # Express app, порт 3001, static /images
│   │   ├── config/
│   │   │   └── db.ts       # pg.Pool подключение к arclient
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /api/auth/login — проверка PIN по чужой users+userroles+roles
│   │   │   ├── orders.ts       # GET/POST заказы, complete, park, unpark, restore, defrost-*
│   │   │   ├── ingredients.ts  # CRUD ингредиентов + фото
│   │   │   ├── categories.ts   # CRUD категорий + reorder
│   │   │   ├── settings.ts     # GET/PUT настроек
│   │   │   ├── stoplist.ts     # Toggle стоп-лист + история + каскад (recalculateCascadeStops)
│   │   │   ├── recipes.ts      # GET/PUT рецептов
│   │   │   ├── dishes.ts       # GET блюд из ctlg15_dishes + категории/приоритет/defrost + фото (multer)
│   │   │   ├── dishAliases.ts  # GET/POST/DELETE /api/dish-aliases
│   │   │   └── history.ts      # История заказов + Dashboard аналитика
│   │   ├── services/
│   │   │   └── kdsStoplistSync.ts # Адаптер записи в rgst3_dishstoplist (opt-in, см. правило 3)
│   │   └── middleware/
│   │       └── errorHandler.ts # Обработчик ошибок
│   ├── public/
│   │   └── images/
│   │       ├── dishes/         # Фото блюд (multer → slicer_dish_images, миграция 008)
│   │       └── ingredients/    # Фото ингредиентов (multer → slicer_ingredients.image_url, миграция 009)
│   └── migrations/             # 001–026
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
│       ├── 014_stop_actor_tracking.sql           # stopped_by_*/resumed_by_*/actor_source в стоп-таблицах
│       ├── 015_rgst3_archive_with_actor.sql      # триггер пишет stopped_by_* из users по OLD.inserter
│       ├── 016_dish_defrost.sql                  # разморозка: slicer_dish_defrost + defrost_* в order_state
│       ├── 017_dessert_auto_park.sql             # авто-парковка десертов: категория + настройки
│       ├── 018_effective_created_at.sql          # Вариант Б парковки: effective_created_at + parked_by_auto
│       ├── 019_dessert_modifier_trigger.sql      # авто-парковка только при модификаторе "Готовить%/Ждать%"
│       ├── 020_per_dish_defrost_duration.sql     # per-dish время разморозки; глобальное время удалено
│       ├── 021_unstop_master_policy.sql          # «наш DELETE» через rgst3_row_suuid, а не inserter_text
│       ├── 022_merge_ack.sql                     # merge_ack: персист merge-подтверждения виртуальных карточек
│       ├── 023_course_pace.sql                   # course_pace_seconds: шаг курса умной очереди v2 «Темп курсов»
│       ├── 024_course_pace_default_600.sql       # шаг курса: дефолт 600 + семантика «окно уступки» (заморозка курсов — в коде)
│       ├── 025_course_pace_check.sql             # CHECK 10..3600 на course_pace_seconds (ревью 2026-07-11)
│       └── 026_new_order_sound.sql               # звук нового заказа: enable_new_order_sound (default TRUE)
├── BD_docs/                # Документация БД для программистов
│   ├── README.md           # Обзор архитектуры, ER-схема
│   ├── mappings.md         # TypeScript ↔ DB маппинг
│   ├── existing_tables.md  # Документация таблиц KDS
│   ├── tables/             # Документация каждой slicer_ таблицы
│   └── migrations/         # Описание миграций
└── public/images/          # Статические изображения (легаси-моки)
```

## Архитектура

### Управление состоянием
- **Хуки + API** — данные загружаются из PostgreSQL через REST API (`services/` → `server/`)
- **Polling** — `useOrders` опрашивает `GET /api/orders` каждые 4 секунды
- **Оптимистичные обновления** — UI обновляется сразу, при ошибке откат через `reload*()` из БД
- **Нет Redux/Zustand** — состояние в хуках, prop drilling
- **Основные state-переменные:**
  - `orders: Order[]` — активные заказы (polling из docm2_orders + slicer_order_state)
  - `dishes: Dish[]` — справочник блюд (из ctlg15_dishes)
  - `categories: Category[]` — категории (из slicer_categories)
  - `ingredients: IngredientBase[]` — ингредиенты (из slicer_ingredients)
  - `settings: SystemSettings` — настройки (из slicer_settings; сохранение с дебаунсом 500 мс в App.tsx)
  - `stopHistory: StopHistoryEntry[]` — история стопов (из slicer_stop_history)
  - `orderHistory: OrderHistoryEntry[]` — история заказов (из slicer_order_history)

### Ключевые паттерны

1. **Стек-архитектура заказов (quantity_stack / table_stack) + Merge**
   - Backend отдаёт **одну позицию чека (`docm2tabl1_items.suuid`) = один Order** с `quantity_stack=[qty]`, `table_stack=[[стол]]`. Никакой агрегации на сервере нет.
   - Многоблочные стеки (`[2, 1]` → на карточке «2 + 1», Done заблокирован до Merge) возникают из:
     - **restore из истории** — конкатенация снапшота с остатком на доске (`useOrders.handleRestoreOrder`);
     - **виртуальных карточек Smart Wave** — каждый неподтверждённый source-заказ = отдельный блок стека.
   - Merge реального заказа персистится в `slicer_order_state` (`POST /api/orders/:id/merge`, схлопывает стек). Merge **виртуальной** карточки — флаг `merge_ack=TRUE` у всех её source-заказов (`POST /api/orders/merge-ack`, миграция 022): подтверждённые source-ы рисуются одним блоком, новые (FALSE) — отдельными («2 + 1»). Флаг живёт в БД → переживает F5/переключение вкладок, синхронен между планшетами. Сбрасывается при `/restore`.

2. **«Волновая Агрегация (Умная)» v2 — модель «ТЕМП КУРСОВ» — `smartQueue.ts` → `buildSmartQueue`**
   - Включена по умолчанию (`enable_smart_aggregation=true`). Переписана 2026-07-07 (была волновая FIFO-симуляция, стала «Темп курсов» — дизайн владельца); 2026-07-11 — **курсы «заморожены» по визиту** (ревью владельца). Решает две проблемы: большой стол «съедал» очередь своими курсами (маленькие ждали), а «маленькие вперёд» голодало большой стол при потоке новых.
   - **Механика:**
     - Каждый гость (`waveKey`) движется по СВОИМ курсам независимо. Курсы = уникальные категории **всех позиций визита** по `sort_index` (0,1,2…): активные на доске + активно размораживающиеся + **уже отданные** (backend отдаёт их в `Order.visit_completed_dish_ids`/`visit_started_at` — из `slicer_order_state COMPLETED` по открытым чекам гостя; чек закрыт → визит окончен). ⚠️ С ревью 2026-07-11 контекст визита считается **только по чекам, у которых есть живые позиции на доске**: зависший незакрытый чек прошлой компании за тем же столом (на проде у стола бывает несколько открытых чеков) больше не впрыскивает фантомные курсы и не уводит старт визита в прошлое; заодно запрос не сканирует все накопленные COMPLETED-строки. Раздельные чеки одной компании работают как раньше — пока гость ждёт хоть одно блюдо, его чек живой. Паркованные курсами не считаются (Вариант Б вернёт их «как новые»), ULTRA — вне курсов.
     - **Заморозка курсов (2026-07-11)** — ключевое свойство: «Готово» НЕ пересобирает очередь. Раньше курс считался по оставшимся позициям: после отдачи супа горячее «повышалось» до курса 0, его `vt` падал до времени пробития — стол получал все блюда подряд, обгоняя первые курсы соседей, а ручка шага не влияла на живой порядок. Теперь `vt` позиции неизменен всю её жизнь; единственная пересборка после «Готово» — легальное вливание одинакового блюда ВВЕРХ, когда его ограничитель (свой ранний курс) отдан. **Липкий vt-кэш** (ревью 2026-07-11): `buildSmartQueue` принимает `persistentVt` (Map в `vtStickyCacheRef` SlicerStation) — однажды рассчитанный `vt` заказа переживает пересборки, инвалидируется только сменой `created_at` (парковка Вариант Б/restore) или шага курса. Без него `vt` «проседал» в окно между оптимистичным «Готово» и приходом свежего visit-контекста со следующим polling (~4 сек) и при снятии категории с отданного блюда посреди смены — карточки прыгали.
     - **Виртуальное время позиции**: `vt = max(время пробития, старт визита гостя + номер_курса × coursePaceMs)`. `coursePaceMs` = `slicer_settings.course_pace_seconds` × 1000 (миграции 023/024, по умолчанию 600 сек, правится в UI). Семантика — **«окно уступки»**: на сколько курс N стола уступает дорогу первым курсам гостей, пришедших позже; после наступления `vt` позицию уже никто не обгонит (новые заказы получают `vt` ≥ «сейчас»). `vt` — только порядок при конкуренции, НЕ задержка: при свободной очереди блюдо режется сразу.
     - Позиции сортируются по `vt` → категория → время пробития, жадно собираются в карточки. Одинаковое блюдо вливается в верхнюю карточку этого блюда **ниже** карточки последнего предыдущего курса гостя (слияние не даёт курс N раньше N−1). Ключ карточки фиксируется при создании — вливания её не двигают («десерт не сползает»).
     - ULTRA — отдельно сверху (FIFO).
   - **Зачем именно так** (выбор владельца — «честность по времени прихода», а не «маленькие столы вперёд»): стол с одним десертом не ждёт полные обеды соседей (его `vt` = времени его прихода), а большой стол не голодает (его курс N имеет фиксированный `vt` = старт визита + N×шаг, новички после этого момента встают позже, максимальная уступка = N×шаг). Эталонный пример владельца (ревью 2026-07-11): стол 1 (суп+салат+биф), стол 2 (суп+биф), стол 3 (биф), стол 4 (десерт) → `Суп×2(1,2) → Биф×2(2,3) → Десерт(4) → Салат(1) → Биф(1)` — воспроизводится при шаге 600, ломается при 120/0.
   - **«Гость» = waveKey**: стол → `t<номер>`; позиция без стола (доставка/самовывоз) → `o<id чека>` (`Order.source_order_id` = `docm2_orders.suuid`), чтобы независимые доставки не сцеплялись. Формат — ЕДИНЫЕ хелперы `waveKeyFor()` (smartQueue.ts) и `visitKeyFor()` (orders.ts), связанные контракт-комментариями: менять только синхронно (раньше формат был выписан вручную в 4 местах).
   - `SmartQueueGroup[]` → виртуальные `Order`: база id `smart_${dishId}_${wasDefrosted}` + порядковый суффикс `_1`, `_2`… для повторных позиций того же блюда (одно блюдо может законно занять 2+ места). Маппинг виртуальный id → реальные source-заказы в `smartQueueMappingRef`; «Готово»/«Частично» — по source-ам (FIFO по created_at). ⚠️ Суффикс позиционный и НЕстабильный между пересборками, поэтому всё, что живёт дольше одного тика, привязывается не к виртуальному id: клейм «В работе» 🔪 — к якорю `claimAnchorOf()` (первый source карточки), модалка «Частично» — к снапшоту source-ов, снятому при открытии (ревью 2026-07-11).
   - Группировка по паре `(dishId, wasDefrosted)` — размороженные и свежие порции не склеиваются. Очередь пересобирается каждую секунду (`now` в deps) — истёкшая разморозка возвращается в сетку мгновенно.

3. **Иерархия ингредиентов + каскадный стоп блюд**
   - Двухуровневая иерархия: Parent (Potatoes) → Children (Raw Potato, Mashed...), поле `parentId` в `IngredientBase`. Стоп родителя каскадирует на все children.
   - **Каскадная логика живёт на backend** (`server/src/routes/stoplist.ts`, функция `recalculateCascadeStops`). После любого `POST /api/stoplist/toggle` ингредиента в той же транзакции:
     - Вычисляется целевой набор блюд, которые должны быть на каскадном стопе (с учётом parent-hierarchy + алиасов блюд)
     - Разница с текущими `CASCADE`-строками в `slicer_dish_stoplist` применяется через `DELETE` (с записью в `slicer_stop_history`) + `INSERT ON CONFLICT DO NOTHING`
     - MANUAL-стопы никогда не перезаписываются каскадом
   - Фронтенд `useStopList.ts` не содержит каскадной логики — после toggle он только вызывает `reloadDishes()` + `reloadIngredients()`
   - **Стоп-лист блюд = UNION двух источников** в `GET /api/dishes`: `rgst3_dishstoplist` (чужая KDS, read-only) + `slicer_dish_stoplist` (наш модуль). Причина из `slicer_dish_stoplist` (Missing: X или Manual) имеет приоритет над пустым reason из `rgst3`.

4. **Парковка столов (Вариант Б — миграция 018)**
   - Table parking = откладывание заказов с таймером возврата. Split не реализован: парковка переводит ВЕСЬ заказ в `status='PARKED'`, `parked_tables` = дедуплицированный `table_stack.flat()`.
   - **Семантика `accumulated_time_ms`**: «общее время парковок», накопление происходит при `/unpark`, а не при `/park`. Формула таймера на клиенте — `elapsed = (pivot - created_at) - accumulated_time_ms`, где `pivot = parked_at` если PARKED (замирание), иначе `now`.
   - **Разделение ручной / авто парковки через `parked_by_auto`:**
     - Ручной `/park`: `parked_by_auto=FALSE`, `accumulated_time_ms` не трогаем. Ручной `/unpark`: `accumulated_time_ms += (NOW() - parked_at)`, `effective_created_at` не трогаем → заказ возвращается на историческое место в очереди.
     - Авто-парковка десерта (в GET): `parked_by_auto=TRUE`. Авто-разпарковка (`unpark_at<=NOW()` в GET): `accumulated_time_ms=0`, `effective_created_at=unpark_at` → десерт «как новый», встаёт в конец очереди.
     - Ручной `/unpark` авто-припаркованного (гость сказал «несите уже»): `accumulated_time_ms=0`, `effective_created_at=NOW()`.
   - `GET /api/orders` отдаёт `created_at = COALESCE(state.effective_created_at, items.docm2tabl1_ordertime)` — одно поле и для таймера, и для сортировки.
   - `parked_tables: number[]` — гранулярный трекинг каких столов паркованы (накопительно за смену).
   - **UI панели парковки**: при разных `unpark_at` на одном столе заголовок показывает диапазон `12:30–12:40 (разное время)` + бейдж у каждой позиции.

5. **Scroll-to-Accept (OrderCard)**
   - Если >5 ингредиентов → кнопка Done заблокирована, разблокируется при прокрутке списка до конца. Предотвращает случайное завершение без просмотра всех компонентов.

6. **Алиасы блюд (Dish Aliases) — общий рецепт для вариантов**
   - Одно логическое блюдо имеет варианты: `163 Баклажаны` (зал) и `Д163 Баклажаны` (доставка). Для нарезчика — одно блюдо, один рецепт.
   - Таблица `slicer_dish_aliases (alias_dish_id PK → primary_dish_id)`.
   - **Резолв на backend**: в `GET /api/orders` через `COALESCE(alias.primary_dish_id, dish_id)` — фронтенд получает заказы как будто алиасов не существует. В `GET /api/dishes` возвращается `recipe_source_id`.
   - **Автокопия категорий**: `POST /api/dish-aliases` в одной транзакции копирует `category_ids` primary → alias.
   - **Канонизация в smartQueue**: `flattenOrders` использует `canonicalDishId = rawDish.recipe_source_id || rawDish.id` (защита; на реальных заказах no-op, т.к. резолв уже сделан на бэке).
   - Ограничение: `alias_dish_id` — PK → одно блюдо = один рецепт. Управление через UI в `RecipeEditor.tsx` (кнопка «Связать»).
   - **Синхронный стоп-лист по группе** (с миграции 021+): ручной toggle блюда через `resolveAliasGroup()` распространяется на ВСЮ группу (primary + все алиасы), в обе стороны (stop и unstop). История пишется для каждого блюда группы; в UI записи алиасов резолвятся на primary display name.

7. **Ручное назначение категорий блюдам (slicer_dish_categories)**
   - Чужая `ctlg15_dishes.ctlg15_ctlg38_uuid__goodcategory` не маппится на slicer-категории — нарезчик сам назначает категории через UI «Рецепты».
   - `GET /api/dishes` собирает `category_ids` через `array_agg`; `PUT /api/dishes/:dishId/categories` — полная замена в транзакции.
   - **Блюда без slicer-категории не попадают на доску** (фильтр `EXISTS slicer_dish_categories` в `GET /api/orders` по каноническому dish_id + дублирующая защита в `smartQueue.flattenOrders`). Семантика: «нет категории = готовое блюдо, идёт мимо нарезчика». Секция «Без категории» в RecipeEditor — todo-лист для новых блюд.

8. **COURSE_FIFO и окно COURSE_FIFO (`course_window_seconds`) — только СТАНДАРТНЫЙ режим**
   - Применяется, когда ОБА тумблера агрегации выключены (`active_priority_rules` содержит `COURSE_FIFO`). Заказы группируются по bucket'ам `floor(created_at / окно)`: внутри — по категории (sort_index), между — строго FIFO.
   - **Значение окна = из UI: Админка → «Ранжирование и Приоритеты» → «⏱️ Окно COURSE_FIFO (секунды)» (10..3600). Дефолта нет — истина в `slicer_settings.course_window_seconds` (сейчас 10 сек).**
   - ⚠️ **С 2026-07-07 умная очередь больше НЕ использует это окно** — она перешла на `course_pace_seconds` (модель «Темп курсов», паттерн 2). `course_window_seconds` остаётся только для стандартной сортировки.
   - `SortRuleType: 'ULTRA' | 'FIFO' | 'CATEGORY' | 'COURSE_FIFO'`; активные правила — `slicer_settings.active_priority_rules`. Работают только в стандартном режиме (оба тумблера OFF).

9. **«Окно Агрегации» = РЕЖИМ СКОРОСТИ (`enable_aggregation`, реализован 2026-07-06)**
   - Это второй режим очереди (движок `buildSpeedQueue` в `smartQueue.ts`), а не отдельная «фича окна». Терминология владельца: «Окно Агрегации» — просто название режима, в котором нарезчик работает на скорость.
   - **Правила режима скорости:**
     1. Порядок категорий (суп → горячее) НЕ сохраняется — ни внутри стола, ни между столами.
     2. ВСЕ порции одного блюда на доске объединяются в одну карточку — **без ограничения по времени** (пока карточка не отдана, новые порции вливаются).
     3. Карточка встаёт по времени САМОГО РАННЕГО заказа и не двигается — «сползание вниз» исключено конструкцией (строгий FIFO по earliestOrderTime).
     4. ULTRA — всегда сверху (общий закон модуля).
   - Пайплайн виртуальных карточек в `SlicerStation` общий с умной очередью: merge_ack, распределение «Готово» по source-ам, разморозка — работают одинаково.
   - `aggregation_window_minutes` — **легаси-колонка**: лимит времени слияния убран решением владельца (слияние безлимитное), UI-поле «минут» удалено, кодом не используется.
   - Тумблеры взаимоисключающие: Smart Wave ON ↔ Aggregation OFF. Оба OFF = стандартная сортировка (каждая позиция чека — отдельная карточка, без объединения).
   - **Сравнение режимов** (проверено симуляцией на реальном коде): заказы «12:00:00 стол1 Рыба · 12:00:05 стол1 Суп · 12:01 стол2 Рыба» →
     - Умная: `#1 Суп(Т1) → #2 Рыба×2(Т1,Т2)` — суп стола сдержал его рыбу (волна);
     - Скорость: `#1 Рыба×2(Т1,Т2) → #2 Суп(Т1)` — курсы игнорируются, режем что раньше пробито.

10. **Авторизация по PIN из чужой таблицы `users`**
    - Модуль закрыт `LoginScreen`. PIN — 4-значный integer из `users.pin` заказчика.
    - Backend `POST /api/auth/login`: `SELECT ... FROM users u LEFT JOIN userroles ur ... LEFT JOIN roles r ... WHERE u.pin=$1 AND u.locked=false AND u.pin>0`. Возвращает `{uuid, login, roles: string[]}`.
    - Фронт хранит сессию в `localStorage` (ключ `slicer_auth_user`). F5 не разлогинивает. Автовыхода нет — только ручной «Выйти» (по требованию заказчика).
    - **Матрица роль→вкладки** в `constants.ts` → `ROLE_ACCESS`:
      - `admin`, `Администратор`, `Заведующий производством` → все 4 вкладки
      - `Официант` → только `KDS`; `Просмотр отчётов` → только `DASHBOARD`
      - `Кухня`, `Хостес`, `Кассир` и все неперечисленные → пусто (экран «Нет доступа» + Выйти)
    - `getAllowedViews(roles)` объединяет права всех ролей юзера.
    - **Защита только клиентская** — backend НЕ проверяет роль на write-endpoints (требование заказчика: кухонный планшет, не production-grade auth).

11. **Отслеживание актора стопов (кто поставил / кто снял)**
    - Миграция 014: колонки `stopped_by_uuid/name`, `resumed_by_uuid/name`, `actor_source` в `slicer_stop_history`; `stopped_by_*` + `actor_source` в `slicer_dish_stoplist`; `stopped_by_*` в `slicer_ingredients`.
    - `actor_source`: `'slicer'` (наш модуль), `'kds'` (основная KDS), `'cascade'` (автокаскад от ингредиента).
    - Источники: (1) slicer — фронт передаёт `actorUuid/actorName` из `useAuth` в toggle; (2) kds — `GET /api/stoplist/history` резолвит `rgst3.inserter` через `users`; (3) kds через DELETE — триггер (миграция 015); (4) cascade — `recalculateCascadeStops(client, actor)` копирует актора в CASCADE-строки.
    - Старые записи (до 014): actor_* = NULL, UI показывает «—». UI: `<ActorLine>` в `StopListHistorySection.tsx`, бейджи `[KDS]` / `[каскад]`.

12. **Разморозка блюд (миграции 016 + 020)**
    - Per-dish флаг «Требует разморозки?» + per-dish время (1..60 мин, по умолчанию в UI 15) в `slicer_dish_defrost` **на primary-блюдо** (alias наследует через `recipe_source_id`). Правится в RecipeEditor.
    - Глобальное время удалено миграцией 020; в `slicer_settings` остался только `enable_defrost_sound`.
    - **Три состояния карточки:** Ожидание (кликабельная синяя ❄️) → В процессе (карточка уходит из очереди в мини-ряд `DefrostRow`; фильтр `isDefrostActive` в `smartQueue.flattenOrders` и в стандартном режиме) → Разморожено (возврат в очередь на место по `created_at`; статичная серая ❄️; ULTRA сохраняется).
    - «Разморозилась» (ручное подтверждение) бэкдейтит `defrost_started_at = NOW() - (duration+1)s`. Отдельной колонки завершения нет — состояние выражается парой started_at/duration.
    - **Smart Wave**: defrosting-заказы группируются по `(dish_id + started_at mod 5s)` → одна мини-карточка на «вспышку»; резолв виртуального id → `sourceOrderItemIds[]`; backend апдейтит все items одной транзакцией.
    - **Разделение агрегации по defrost-статусу**: `groupItemsByDish` группирует по `(dishId + wasDefrosted)` — защита от перезапуска таймера на уже размороженной рыбе. На ULTRA и сортировку флаг не влияет.
    - **Сброс defrost-state** при: park (парковка доминирует), restore (чистый лист), defrost-cancel.
    - **Звук**: Web Audio beep (`playDefrostBeep` в `utils.ts`, тумблер `enable_defrost_sound`, default TRUE). Логика живёт в `SlicerStation` (не в DefrostRow — туда попадают только активные разморозки, истёкшая исчезает тем же тиком): эффект следит за сырыми `orders` и играет сигнал ТОЛЬКО на живом переходе таймера «идёт → истёк» (ключ `id_startedAt`). Ключ, впервые увиденный уже истёкшим, не звучит — отсекает ложные сигналы при F5 и при ручном «Разморозилась» (бэкдейт started_at).

13. **Авто-парковка десертов (миграции 017 + 019)**
    - При первом появлении дессертной позиции в `GET /api/orders` backend INSERT'ит `slicer_order_state` со `status=PARKED`, `unpark_at = ordertime + X мин` (или до «HH:MM» из модификатора), `parked_by_auto=TRUE`.
    - **Триггер через модификатор (019)**: правило срабатывает ТОЛЬКО если у позиции есть модификатор из `ctlg20_modifiers`, чьё имя матчит паттерн из `slicer_settings.dessert_trigger_modifier_patterns` (default `{Готовить%, Ждать%}`). `"Готовить к HH.MM"` парсится в конкретное время (при нескольких — MAX).
    - Правило проверяет что дессертная категория — **основная** (min sort_index) у блюда, и `quantity > 0`.
    - Настройки: `dessert_category_id` (FK→slicer_categories ON DELETE SET NULL), `dessert_auto_park_enabled` (default false), `dessert_auto_park_minutes` (1..240, default 40), `dessert_trigger_modifier_patterns` (правится только SQL-ом).
    - UI: тумблер + минуты на карточке дессертной категории в `CategoriesTab`. `DELETE /api/categories/:id` отдаёт 409 для системной категории (в UI — 🔒).
    - `ON CONFLICT (order_item_id) DO NOTHING` — повторно не паркуем, если нарезчик уже вернул вручную.

## Навигация (ViewMode)
| Mode | Компонент | Описание |
|---|---|---|
| `KDS` | `SlicerStation` | Основная доска заказов |
| `STOPLIST` | `StopListManager` | Управление стоп-листом |
| `ADMIN` | `AdminPanel` | Администрирование |
| `DASHBOARD` | `Dashboard` | Отчёты и аналитика |

## Ключевые настройки и константы
- **Порт** dev-сервера: `3000`, backend: `3001` (`vite.config.ts` проксирует `/api` и `/images`)
- **Polling заказов**: каждые 4 секунды (`useOrders`)
- **Окно COURSE_FIFO**: значение из UI (`slicer_settings.course_window_seconds`), **дефолта нет** — стандартный режим, см. паттерн 8
- **Шаг курса умной очереди**: `slicer_settings.course_pace_seconds` (по умолчанию 600 сек, миграция 024) — «окно уступки» поздних курсов новым гостям, правится в UI под тумблером «Волновая Агрегация» — см. паттерн 2
- **Удержание истории**: `slicer_settings.history_retention_minutes` (правится в UI, макс 120)
- **«Окно Агрегации»** (`enable_aggregation`): тумблер режима скорости — см. паттерн 9. Колонка `aggregation_window_minutes` — легаси, не используется (слияние безлимитное)
- **Звук нового заказа**: `enable_new_order_sound` (миграция 026, default TRUE) — двойной beep при появлении нового заказа на доске. Эффект `knownOrderIdsRef` в `SlicerStation`: первый снапшот после загрузки запоминается молча (нет ложного сигнала при F5), restore того же id не звучит, один beep на тик поллинга. Тумблер — Админка → Общие Настройки, рядом со звуком разморозки
- **KITCHEN_STORAGE_UUIDS**: whitelist кухонных складов, жёстко прописан в `server/src/routes/orders.ts` и `server/src/routes/dishes.ts` (при деплое на другой ресторан — обновить)

## Стилизация
- **TailwindCSS 4 через PostCSS**: `postcss.config.js` (`@tailwindcss/postcss` + autoprefixer), тема в `tailwind.config.js`, вход через `index.css` (`@import "tailwindcss"` + `@config`). CDN больше не используется.
- **Кастомные цвета:** `kds-bg`, `kds-card`, `kds-header`, `kds-accent`, `kds-ultra`, `kds-vip`, `kds-success`, `kds-weight`, `kds-border`
- **Кастомные тени:** `glow-red`, `glow-orange`, `glow-green`
- **Тёмная тема** только (нет переключателя); фон и кастомный скроллбар — в `index.css`

## Команды
```bash
# Frontend
npm install       # Установка зависимостей фронтенда
npm run dev       # Dev-сервер (порт 3000, proxy /api и /images → 3001)
npm run build     # Production сборка
npm run typecheck # Проверка типов (tsc --noEmit); @types/react установлены — props проверяются честно
npm run lint      # ⚠️ НЕРАБОЧИЙ: eslint отсутствует в devDependencies (конфиг eslint.config.js есть)

# Backend
cd server && npm install  # Установка зависимостей сервера
cd server && npm run dev  # Dev-сервер (порт 3001, hot-reload через ts-node-dev)

# Миграции БД (все 25 по порядку, с ON_ERROR_STOP)
cd server && npm run migrate
# Либо одну вручную:
cd server && psql -U postgres -d arclient -f migrations/001_create_slicer_tables.sql
```

## База данных (PostgreSQL)

### Подключение
- **БД:** `arclient` на `localhost:5432`
- **Пользователь:** `postgres` / `1234`
- **Backend сервер:** Express на порту `3001`
- **Vite proxy:** `/api` и `/images` → `localhost:3001`

### Существующие таблицы KDS (ТОЛЬКО ЧТЕНИЕ):
| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `docm2_orders` | Заказы | suuid, docm2_ctlg13_uuid__halltable, docm2_opentime |
| `docm2tabl1_items` | Позиции заказа | suuid, owner(→orders), docm2tabl1_ctlg15_uuid__dish, docm2tabl1_quantity, docm2tabl1_cooked |
| `docm2tabl2_dishmodifiers` | Модификаторы позиций | docm2tabl2_itemrow(→items), docm2tabl2_ctlg20_uuid__modifier |
| `ctlg15_dishes` | Блюда | suuid, name, code, ctlg15_ctlg38_uuid__goodcategory |
| `ctlg13_halltables` | Столы | suuid, ctlg13_tablenumber |
| `ctlg14_shifts` | Смены | suuid, ctlg14_closed |
| `ctlg18_menuitems` | Меню (блюдо↔склад) | ctlg18_ctlg15_uuid__dish, ctlg18_ctlg17_uuid__storage |
| `ctlg17_storages` | Склады-цеха | suuid, name (whitelist: только Кухня) |
| `ctlg20_modifiers` | Справочник модификаторов | suuid, name («Готовить к 18.00»...) |
| `rgst3_dishstoplist` | Стоп-лист блюд | rgst3_ctlg15_uuid__dish, inserter |
| `users` | Пользователи заказчика | uuid, login, pin (4 цифры), locked |
| `userroles` | Связь user ↔ роль (M2M) | user_uuid, role_uuid, bydefault |
| `roles` | Справочник ролей | uuid, name ('admin', 'Официант', ...) |

Исключение по записи — `rgst3_dishstoplist` при включённой синхронизации (см. правило 3).

### Таблицы модуля нарезчика (prefix `slicer_`):
| Таблица | Назначение |
|---|---|
| `slicer_categories` | Категории с порядком сортировки |
| `slicer_dish_categories` | Ручное назначение slicer-категорий блюдам (dish_id → category_id) |
| `slicer_ingredients` | Справочник ингредиентов (parent→child, стоп-лист, buffer_percent, image_url) |
| `slicer_recipes` | Рецепты: блюдо → ингредиент + граммовка |
| `slicer_dish_aliases` | Алиасы блюд: общий рецепт для вариантов (163/Д163) |
| `slicer_dish_stoplist` | Актуальный стоп-лист блюд модуля (MANUAL + CASCADE) + `rgst3_row_suuid` линковка |
| `slicer_dish_images` | Фото блюд: путь до файла в `server/public/images/dishes/` |
| `slicer_dish_priority` | Приоритет блюда (1=NORMAL, 3=ULTRA) per-dish; нет записи = NORMAL |
| `slicer_dish_defrost` | Per-dish «требует разморозки?» + время в минутах; хранится на primary |
| `slicer_kds_sync_config` | Singleton-конфиг двусторонней синхронизации с rgst3 (OFF по умолчанию) |
| `slicer_order_state` | Теневое состояние позиций: статус, стеки, парковка, effective_created_at, finished_at, defrost_*, merge_ack (022) |
| `slicer_order_history` | Завершённые заказы (KPI, snapshot) |
| `slicer_ingredient_consumption` | Расход ингредиентов (для отчётов) |
| `slicer_stop_history` | История стопов + акторы (stopped_by_*/resumed_by_*/actor_source) |
| `slicer_settings` | Настройки модуля (singleton, id=1) |

### Колонки `slicer_settings` (актуально на 2026-07-12)
`aggregation_window_minutes` (легаси, не используется), `history_retention_minutes`, `active_priority_rules` (jsonb), `course_window_seconds` (стандартный режим), `course_pace_seconds` (умная v2, миграции 023/024/025 — «окно уступки», default 600, CHECK 10..3600), `restaurant_open_time`, `restaurant_close_time`, `excluded_dates` (jsonb), `enable_aggregation` (режим скорости, паттерн 9), `enable_smart_aggregation`, `enable_kds_stoplist_sync`, `enable_defrost_sound`, `enable_new_order_sound` (звук нового заказа, миграция 026, default TRUE), `dessert_category_id`, `dessert_auto_park_enabled`, `dessert_auto_park_minutes`, `dessert_trigger_modifier_patterns` (text[]).

### ⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА работы с БД

1. **Каждое изменение схемы БД** ОБЯЗАНО быть задокументировано в `BD_docs/`:
   - Новая таблица → `BD_docs/tables/<table_name>.md`
   - Новая миграция → `BD_docs/migrations/<NNN>_<description>.md`
   - Изменение маппинга → `BD_docs/mappings.md`

2. **Формат документации таблицы** (`BD_docs/tables/*.md`): название и назначение (на русском); колонки (имя, тип, NOT NULL, DEFAULT, описание); индексы и FK; связанные таблицы и JOIN'ы; примеры INSERT/SELECT; метод связывания.

3. **Это нужно** чтобы программист заказчика мог воспроизвести всё на продакшн-системе без ошибок.

4. **Префикс `slicer_`** — обязателен для всех новых таблиц модуля.

5. **Не трогать структуру** существующих таблиц KDS. Два исключения (см. правило 3 выше): запись в `rgst3_dishstoplist` при включённой синхронизации; BEFORE DELETE триггер-архиватор на `rgst3_dishstoplist` (не меняет схему, не блокирует DELETE).

## API Endpoints
- `POST /api/auth/login` — авторизация по PIN. Body: `{pin: number}`. Возвращает `{uuid, login, roles}` или 401.
- `GET /api/orders` — активные заказы (polling каждые 4 сек). Внутри также: авто-парковка десертов, авто-разпарковка по `unpark_at`, резолв алиасов, фильтры (кухонный склад, есть slicer-категория, qty>0, не cooked). В ответе есть `source_order_id` (чек чужой KDS — для волн доставок), `merge_ack` (022) и контекст визита для «замороженных» курсов (2026-07-11): `visit_completed_dish_ids` + `visit_started_at` — уже отданные позиции открытых чеков гостя (из `slicer_order_state COMPLETED`; только чеки с живыми позициями на доске — зависшие чеки прошлых компаний отсечены, см. паттерн 2). Визит-запрос зависит от основного (список живых чеков), поэтому выполняется после него; при пустой доске пропускается.
- `POST /api/orders/:id/complete` — завершить заказ (slicer_order_state COMPLETED + finished_at, история, расход)
- `POST /api/orders/:id/partial-complete` — частичное завершение
- `POST /api/orders/:id/restore` — вернуть из истории (UPSERT state: ACTIVE, стеки, чистый лист по парковке/разморозке/merge_ack)
- `POST /api/orders/:id/park` — парковка (ручная, parked_by_auto=FALSE, сбрасывает defrost)
- `POST /api/orders/:id/unpark` — снять с парковки (две ветки по parked_by_auto — см. паттерн 4)
- `POST /api/orders/:id/merge` — объединить стеки реального заказа (стандартный режим)
- `POST /api/orders/merge-ack` — подтвердить объединение виртуальной карточки Smart Wave: `merge_ack=TRUE` всем `orderItemIds` (миграция 022)
- `POST /api/orders/:id/cancel` — отменить заказ
- `POST /api/orders/:id/defrost-start` — запустить разморозку. Body `{sourceOrderItemIds?}`. Duration per-dish из `slicer_dish_defrost` (JOIN alias→primary, COALESCE 15 мин), UPSERT всех items атомарно.
- `POST /api/orders/:id/defrost-cancel` — сброс defrost-полей → карточка в очередь
- `POST /api/orders/:id/defrost-complete` — «Разморозилась»: бэкдейт started_at → таймер истёк
- `GET /api/dishes` — справочник блюд (ctlg15_dishes + категории + приоритет + defrost + стоп-UNION + recipe_source_id)
- `PUT /api/dishes/:dishId/categories` — назначить slicer-категории (полная замена)
- `PUT /api/dishes/:dishId/priority` — приоритет (1=NORMAL, 3=ULTRA), UPSERT в `slicer_dish_priority`
- `PUT /api/dishes/:dishId/defrost` — флаг разморозки + минуты (UPSERT в `slicer_dish_defrost`; dishId резолвится в primary на фронте)
- `DELETE /api/dishes/:dishId/slicer-data` — полный сброс slicer-данных блюда одной транзакцией: рецепт, категории, алиасы (в обе стороны), приоритет, разморозка. Блюдо возвращается в «Без категории»
- `POST /api/dishes/:dishId/image` / `DELETE ...` — фото блюда (multipart, до 5МБ, → `server/public/images/dishes/`)
- `POST /api/ingredients/:id/image` / `DELETE ...` — фото ингредиента (→ `server/public/images/ingredients/`)
- `GET /api/dish-aliases`, `POST /api/dish-aliases`, `DELETE /api/dish-aliases/:alias_dish_id` — алиасы
- `GET/POST/PUT/DELETE /api/ingredients` — CRUD ингредиентов
- `GET/POST/PUT/DELETE /api/categories` — CRUD категорий (+ 409 на системную дессертную)
- `PUT /api/categories/reorder` — пакетная смена порядка
- `GET/PUT /api/recipes/:dishId` — рецепты
- `GET/PUT /api/settings` — настройки
- `POST /api/stoplist/toggle` — стоп-лист (блюдо → вся alias-группа; unstop блюда → `pushDishUnstopAll`, политика «модуль — мастер»; каскад ингредиента → `pushDishUnstop` только своей строки)
- `GET /api/stoplist/history` — история стопов (+ акторы, склады)
- `GET /api/history/orders`, `DELETE /api/history/orders/:id` — история завершённых заказов
- `GET /api/history/dashboard/speed-kpi` — KPI скорости (нарезчик)
- `GET /api/history/dashboard/chef-cooking-speed` — скорость готовки повара (cooktime − finished_at)
- `GET /api/history/dashboard/ingredient-usage` — расход ингредиентов
- `GET /api/health` — проверка здоровья сервера

## Важные Notes для AI

1. **Backend:** Express + pg на порту 3001, proxy через Vite (`/api`, `/images`)
2. **Тесты отсутствуют** — нет тестового фреймворка
3. **Typecheck полноценный** — `@types/react`/`@types/react-dom` установлены (2026-07-06), props компонентов проверяются. До этого React резолвился как `any` из-за `allowJs`, и tsc пропускал обращения к несуществующим полям.
4. **ESLint не установлен** — `eslint.config.js` есть, но `npm run lint` падает (нет пакета eslint)
5. **Изображения** — фото блюд/ингредиентов хранятся файлами на диске сервера (multer), в БД — пути. Unsplash-ссылки остались только в мёртвых моках `constants.ts`.
6. **Strict Mode включён** — компоненты рендерятся дважды в dev
7. **Все handler-функции** определены в хуках (`hooks/`) и передаются через props
8. **Оптимистичные обновления** — UI сразу, при ошибке API откат через `reload*()`
9. **API-клиент** — все запросы через `services/client.ts`. Папка называется `services/` (не `api/`) из-за конфликта с Vite proxy `/api`
10. **Polling заказов** — каждые 4 секунды; авто-разпарковка и авто-парковка десертов происходят на backend при каждом `GET /api/orders`
11. **Настройки сохраняются с дебаунсом 500 мс** (`App.tsx → handleSettingsChange`), при ошибке — откат из БД
12. **Глобальный гейт настроек**: до `settingsLoaded=true` не рендерится ни один экран (App.tsx показывает «Загрузка настроек…», при недоступном backend — ретрай каждые 3 сек). Хардкод-дефолты в начальном стейте инертны — очередь никогда не строится по ним.
13. **`constants.ts`** — живое: `ROLE_ACCESS`, `getAllowedViews()`. Массивы `INITIAL_*` — легаси-моки, нигде не импортируются.
14. **`vite.config.ts` define GEMINI_API_KEY** — легаси от AI Studio скаффолда, кодом не используется

## Известные проблемы / отложенные работы

> При исправлении — удаляй пункт отсюда. Ревью 2026-07-06 нашло 10 проблем;
> 8 исправлены в тот же день (коллизия virtualId, звук разморозки, «дыра» при
> истечении таймера, персист merge → миграция 022, липкое «В работе»,
> @types/react, волны «стола 0» → waveKey, фантомные порции, тумблеры,
> гейт настроек), «Окно Агрегации» реализовано как режим скорости
> (`buildSpeedQueue`, паттерн 9). Ревью очереди 2026-07-11 нашло «промоушен
> курса после Готово» — исправлен заморозкой курсов по визиту (паттерн 2,
> миграция 024).
>
> **Полное ревью 2026-07-11** (15 агентов, все находки верифицированы):
> исправлено 14 пунктов — фантомные курсы от зависших чужих чеков (визит
> ограничен живыми чеками), транзиентный промоушен после «Готово» и при
> снятии категории (липкий vt-кэш), звук разморозки ×N (один beep на тик),
> нестабильный порядковый суффикс виртуального id (якорь 🔪 + снапшот
> модалки «Частично»), откат merge_ack поллингом (pending-оверлей),
> «стол 0» и дубли столов на карточке, дефолт 120000 в сигнатуре
> buildSmartQueue (параметр стал обязательным), CHECK на шаг курса
> (миграция 025), дедупликация waveKey/SQL-стеков/ULTRA-разделения,
> O(1)-справочник блюд + индекс карточек + визит один раз на гостя,
> валидация настроек через validateIntRange, штампы документации.
> Отложенные пункты:

1. **Фолбэки `|| 300` / `|| 600` для окон очереди** — в `SlicerStation.tsx` (`courseWindowSeconds`, `coursePaceSeconds`) и `CategoryRanking.tsx`: подстраховка на случай не загрузившихся настроек. После глобального гейта настроек в App.tsx (2026-07-06) практически недостижимы — сработают только при NULL/0 из БД, чего схема (NOT NULL DEFAULT + CHECK с миграции 025) не допускает. Чистка отложена.
2. **Остаток карточки после частичной отдачи «убегает» вниз** (ревью 2026-07-11, пункт 3, низкий приоритет): «Частично» закрывает самый старый source (FIFO), на пересборке ключ карточки пересчитывается по `vt` оставшегося более позднего source — карточка перепрыгивает ниже (в тесте: с #1 на #3). Формально честно (остаток встаёт на свою позицию по пробитию), но нарезчику неожиданно: недорезанное блюдо уехало. Возможный фикс — наследовать ключ карточки от самого раннего когда-либо влитого source (требует памяти между пересборками). Владелец отложил. (Липкий vt-кэш 2026-07-11 этого не меняет — он хранит vt на заказ, а не ключ карточки.)
3. **Поздний дозаказ раннего курса может влиться выше него** (полное ревью 2026-07-11, финд №3): если стол дозаказал суп ПОСЛЕ горячего, у горячего `vt` меньше, чем у супа, оно обрабатывается раньше, и ограничитель «курс N не выше N−1» ещё не построен — горячее может влиться в чужую верхнюю карточку выше собственного супа. **Владелец принял как норму** («это нормально»): дозаказ раннего курса задним числом — редкий сценарий, а «уступать» уже проданному горячему было бы хуже.
4. **Контекст визита дублируется в каждом Order гостя** (payload): `visit_completed_dish_ids`/`visit_started_at` копируются во все заказы стола вместо одной per-guest секции ответа. Верификатор оценил оверхед как скромный (максимум ~10 uuid на визит); перенос в отдельную секцию ломал бы контракт `Order` — отложено.
5. **COMPLETED-строки slicer_order_state не удаляются** — намеренно: по ним считаются отчёты Dashboard (finished_at) и восстанавливается история. Визит-запрос с 2026-07-11 ограничен живыми чеками и от роста таблицы не страдает; политика ретенции — вопрос будущего (обсудить с заказчиком).
