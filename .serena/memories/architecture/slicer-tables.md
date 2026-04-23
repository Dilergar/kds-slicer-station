# Таблицы модуля Slicer (prefix slicer_)

11 таблиц в БД `arclient` с префиксом `slicer_`. Все создаются миграциями:
- `001_create_slicer_tables.sql` — 8 базовых таблиц
- `002_seed_defaults.sql` — начальные данные
- `003_dish_aliases.sql` — таблица алиасов блюд
- `004_dish_categories.sql` — таблица ручного назначения категорий блюдам
- `005_dish_stoplist.sql` — актуальный стоп-лист блюд (MANUAL + CASCADE)

Подробная документация в `BD_docs/tables/`.

## 1. slicer_categories
Категории с порядком сортировки (sort_index). Используются для COURSE_FIFO.
Поля: id (UUID), name, sort_index, created_at, updated_at.
Начальные данные: VIP(0), Супы(1), Салаты(2), Горячее(3), Десерты(4).

## 2. slicer_ingredients
Справочник ингредиентов с иерархией parent→child и стоп-листом.
Поля: id, name, parent_id (FK self, ON DELETE CASCADE), image_url, unit_type ('kg'|'piece'), piece_weight_grams, buffer_percent, is_stopped, stop_reason, stop_timestamp.
С миграции 009 (2026-04-19): image_url хранит путь `/images/ingredients/<id>.<ext>` (файл на диске), НЕ Base64. Добавлены image_content_type + image_file_size. Upload через `POST /api/ingredients/:id/image`, delete через `DELETE /api/ingredients/:id/image`. Base64 data-URL очищены миграцией.
С миграции 010 (2026-04-19): `buffer_percent NUMERIC(5,2) DEFAULT 0` — надбавка в процентах для расчёта брутто в Dashboard → Расход Ингредиентов. Сохраняется через PUT `/api/ingredients/:id` с `{bufferPercent}` (PATCH-семантика), отрисовывается onBlur в `components/dashboard/IngredientUsageSection.tsx`.
**PUT endpoint** использует динамический SET (PATCH) — только поля из body. Раньше static SET обнулял parent_id при частичном апдейте (после загрузки фото Вёшинки отрывались от Грибов). Починено 2026-04-19.
Индексы: idx_slicer_ingredients_parent, idx_slicer_ingredients_stopped (partial).

## 3. slicer_recipes
Связь блюдо→ингредиент с граммовкой на порцию.
Поля: id, dish_id (VARCHAR, ссылка на ctlg15_dishes.suuid БЕЗ FK), ingredient_id (FK slicer_ingredients), quantity_per_portion.
UNIQUE(dish_id, ingredient_id). dish_id без FK потому что ctlg15_dishes — чужая таблица.

**Резолв через алиасы:** рецепт хранится только для primary-блюд. Блюда-алиасы используют рецепт primary через JOIN с slicer_dish_aliases в GET /api/dishes.

## 4. slicer_dish_categories
Ручное назначение slicer-категорий блюдам (user назначает через UI «Рецепты»).
Поля: dish_id (VARCHAR ссылка на ctlg15_dishes.suuid без FK), category_id (UUID FK slicer_categories ON DELETE CASCADE), assigned_at.
PK: (dish_id, category_id) — запрет дубликатов, одно блюдо может быть в нескольких категориях (до 3 в UI).
Индекс: idx_slicer_dish_categories_dish.

Используется:
- Чтение: в `GET /api/dishes` собирается через `array_agg(category_id)` и подставляется в `category_ids` ответа. Если строк нет — блюдо попадает в секцию «Без категории» в RecipeEditor.
- Запись: `PUT /api/dishes/:dishId/categories` (полная замена в транзакции) из `RecipeEditor.saveDishForm`.
- Автокопия: `POST /api/dish-aliases` автоматически копирует category_ids primary → alias в той же транзакции.

## 5. slicer_dish_aliases
Маппинг "блюдо-алиас → блюдо-primary" для решения вариантов одного логического блюда (163 и Д163).
Поля: alias_dish_id (VARCHAR PK), primary_dish_id (VARCHAR NOT NULL), created_at.
Обе колонки — теневые ссылки на ctlg15_dishes.suuid без FK.
**Ограничение:** alias_dish_id = PK → одно блюдо = один рецепт.
Индекс: idx_slicer_dish_aliases_primary.
Резолв на backend: COALESCE(alias.primary_dish_id, d.suuid) в /api/orders (подмена dish_id) и /api/dishes (recipe_source_id). Фронтенд не знает об алиасах.

## 6. slicer_dish_stoplist
Актуальный стоп-лист блюд модуля нарезчика. Одна строка = одно остановленное блюдо.
Поля: dish_id (VARCHAR PK, теневая ссылка на ctlg15_dishes.suuid), stop_type ('MANUAL'|'CASCADE' CHECK), reason (TEXT), stopped_at (TIMESTAMPTZ), cascade_ingredient_id (UUID FK slicer_ingredients ON DELETE CASCADE nullable).
Индексы: idx_slicer_dish_stoplist_cascade_ing (partial для CASCADE), idx_slicer_dish_stoplist_type.

**Архитектурно:**
- MANUAL — ручной стоп от пользователя, не перезаписывается каскадом
- CASCADE — автоматический стоп из-за стопнутого ингредиента, удаляется при возврате ингредиента
- Ручной побеждает каскад (ON CONFLICT DO NOTHING в recalculateCascadeStops)
- В GET /api/dishes делается UNION с rgst3_dishstoplist (основная KDS, чужая read-only)
- При снятии любого стопа пишется slicer_stop_history с duration_ms

**Каскадная логика (recalculateCascadeStops)** вызывается в той же транзакции что и toggle ингредиента — вычисляет целевой набор блюд-каскадов через CTE с учётом parent-hierarchy ингредиентов и алиасов блюд, берёт diff с текущими CASCADE-строками, применяет через INSERT ON CONFLICT DO NOTHING / DELETE с записью в историю.

**Исторический контекст:** до миграции 005 каскад жил во useEffect во фронтенде и не персистился. F5 сбрасывал любые стопы блюд, Dashboard врал по % downtime. Миграция перенесла каскад на backend.

## 7. slicer_order_state
Теневая таблица состояния заказов нарезчика (парковка, merge, статус).
PK: order_item_id (VARCHAR, ссылка на docm2tabl1_items.suuid).
Поля: status ('ACTIVE'|'PARKED'|'COMPLETED'|'CANCELLED'), quantity_stack (JSONB), table_stack (JSONB), parked_at, unpark_at, accumulated_time_ms, was_parked, parked_tables (JSONB).
Индексы: idx_slicer_order_state_status, idx_slicer_order_state_unpark (partial для авто-разпарковки).

## 8. slicer_order_history
Завершённые заказы для KPI-отчётов.
Поля: id, dish_id, dish_name, completed_at, total_quantity, prep_time_ms (BIGINT), was_parked, snapshot (JSONB — полный Order), consumed_ingredients (JSONB).
Индексы: по completed_at, was_parked.

## 9. slicer_ingredient_consumption
Расход ингредиентов при завершении заказов (для SQL-агрегации в отчётах).
Отдельная таблица от JSONB в order_history для эффективных GROUP BY.
Поля: id, order_history_id (FK CASCADE), ingredient_id (FK SET NULL), ingredient_name, unit_type, quantity, weight_grams.

## 10. slicer_stop_history
История стопов для Dashboard (% времени на стопе).
Запись создаётся при СНЯТИИ со стопа (чтобы посчитать duration_ms).
Поля: id, target_type ('ingredient'|'dish'), target_id, target_name, stopped_at, resumed_at, reason, duration_ms.

С миграции 005: каскадные стопы блюд тоже пишутся сюда при снятии — через recalculateCascadeStops() в backend, а не фронтенд-useEffect.

## 12. slicer_dish_images (миграция 008, 2026-04-19)
PK `dish_id VARCHAR(255)` = `ctlg15_dishes.suuid` (чужая таблица, без FK). Колонки: `image_path TEXT NOT NULL` (относительный URL `/images/dishes/<uuid>.<ext>`), `content_type`, `file_size`, `updated_at`. Файлы лежат на диске в `server/public/images/dishes/`. Раздача: Express static (dev) / nginx alias (prod). Upload через multer (POST `/api/dishes/:id/image`, поле `image`, лимит 5МБ, whitelist jpeg/png/gif/webp). DELETE идемпотентный. В `GET /api/dishes` LEFT JOIN даёт `image_url` (пустая строка если нет записи). У ингредиентов пока Base64 в TEXT (slicer_ingredients.image_url) — при необходимости можно мигрировать по той же схеме.

## 11. slicer_settings
Singleton-таблица (CHECK id=1). Все настройки модуля.
Поля: aggregation_window_minutes, history_retention_minutes, active_priority_rules (JSONB), course_window_seconds, restaurant_open_time, restaurant_close_time, excluded_dates (JSONB), enable_aggregation, enable_smart_aggregation.

## Чужие таблицы KDS (только READ по умолчанию)
- `docm2_orders` — заказы
- `docm2tabl1_items` — позиции заказа. Модуль НЕ пишет в `docm2tabl1_cooked`/`docm2tabl1_cooktime` (убрано в миграции 007, 2026-04-18). Это поле под управлением основной KDS. Разница `docm2tabl1_cooktime - slicer_order_state.finished_at` = время готовки повара (метрика).
- `ctlg15_dishes` — справочник блюд
- `ctlg13_halltables` — столы
- `ctlg14_shifts` — смены
- `ctlg17_storages` — склады-цеха (whitelist Кухня)
- `ctlg18_menuitems` — меню ресторана (блюдо↔склад, источник для /api/dishes)
- `rgst3_dishstoplist` — стоп-лист блюд основной KDS (чужая, в /api/dishes делается UNION с slicer_dish_stoplist)
