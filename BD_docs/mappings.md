# Маппинг TypeScript ↔ PostgreSQL

## Order (types.ts) ↔ docm2_orders + docm2tabl1_items + slicer_order_state

| TypeScript поле | DB таблица | DB колонка | Тип DB | Примечание |
|---|---|---|---|---|
| `Order.id` | `docm2tabl1_items` | `suuid` | UUID | PK позиции заказа |
| `Order.dish_id` | `docm2tabl1_items` | `docm2tabl1_ctlg15_uuid__dish` | UUID | FK → ctlg15_dishes.suuid (подмена на primary_dish_id через slicer_dish_aliases) |
| `Order.quantity_stack` | `slicer_order_state` | `quantity_stack` | JSONB | `[2, 1]` = не объединено |
| `Order.table_stack` | `slicer_order_state` | `table_stack` | JSONB | `[[8,5],[51]]` = 2 блока |
| `Order.created_at` | `slicer_order_state` + `docm2tabl1_items` | `COALESCE(state.effective_created_at, items.docm2tabl1_ordertime)` | TIMESTAMP | Точка отсчёта таймера и сортировки. `effective_created_at` сдвигается при авто-парковке десерта (см. миграцию 018) |
| `Order.updated_at` | `slicer_order_state` | `updated_at` | TIMESTAMPTZ | Последнее обновление |
| `Order.status` | `slicer_order_state` | `status` | VARCHAR(10) | 'ACTIVE'\|'PARKED'\|'COMPLETED'\|'CANCELLED' |
| `Order.parked_at` | `slicer_order_state` | `parked_at` | TIMESTAMPTZ | Когда паркован |
| `Order.unpark_at` | `slicer_order_state` | `unpark_at` | TIMESTAMPTZ | Когда авто-возврат |
| `Order.accumulated_time_ms` | `slicer_order_state` | `accumulated_time_ms` | BIGINT | «Общее время парковок» (семантика изменена в 018). Вычитается из elapsed на клиенте |
| `Order.was_parked` | `slicer_order_state` | `was_parked` | BOOLEAN | Был ли паркован (KPI) |
| `Order.parked_tables` | `slicer_order_state` | `parked_tables` | JSONB | `[8, 5]` |
| `Order.parked_by_auto` | `slicer_order_state` | `parked_by_auto` | BOOLEAN | Текущая парковка автоматическая (миграция 018) |
| `Order.defrost_started_at` | `slicer_order_state` | `defrost_started_at` | TIMESTAMPTZ | Момент клика ❄️ (миграция 016) |
| `Order.defrost_duration_seconds` | `slicer_order_state` | `defrost_duration_seconds` | INT | Snapshot duration в секундах (миграция 016) |
| Номер стола | `ctlg13_halltables` | `ctlg13_tablenumber` | NUMERIC | JOIN через docm2_orders.docm2_ctlg13_uuid__halltable |

## Dish (types.ts) ↔ ctlg15_dishes + slicer_recipes + slicer_categories + slicer_dish_aliases

| TypeScript поле | DB таблица | DB колонка | Тип DB | Примечание |
|---|---|---|---|---|
| `Dish.id` | `ctlg15_dishes` | `suuid` | UUID | Приводим к string |
| `Dish.name` | `ctlg15_dishes` | `name` | TEXT | Название блюда (фронт получает с префиксом `code`) |
| `Dish.code` | `ctlg15_dishes` | `code` | TEXT | Код блюда (например `Д163`), используется в RecipeEditor |
| `Dish.recipe_source_id` | `slicer_dish_aliases` | `COALESCE(alias.primary_dish_id, d.suuid::text)` | VARCHAR | Если блюдо — алиас, это primary_dish_id, иначе сам suuid |
| `Dish.category_ids` | `slicer_dish_categories` | `array_agg(category_id) GROUP BY dish_id` | UUID[] | Ручное назначение через UI «Рецепты» (`PUT /api/dishes/:dishId/categories`). Если строк нет → `[]` → блюдо в секции «Без категории». `ctlg15_ctlg38_uuid__goodcategory` **не используется**: маппинга на slicer_categories нет |
| `Dish.priority_flag` | — | — | — | Хранится в slicer_order_state или определяется из меню |
| `Dish.grams_per_portion` | — | — | — | Вычисляется из slicer_recipes SUM(quantity_per_portion) по recipe_source_id |
| `Dish.ingredients` | `slicer_recipes` | `ingredient_id` + `quantity_per_portion` | UUID + NUMERIC | JOIN по `recipe_source_id` (резолв алиасов) |
| `Dish.image_url` | — | — | — | Хранится локально или в slicer_recipes |
| `Dish.is_stopped` | `rgst3_dishstoplist` | наличие записи | — | Если есть запись = на стопе |

## Алиасы блюд (DishAlias) ↔ slicer_dish_aliases

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `alias_dish_id` | `alias_dish_id` | VARCHAR(255) PK | suuid блюда-алиаса |
| `primary_dish_id` | `primary_dish_id` | VARCHAR(255) NOT NULL | suuid блюда-primary |
| `created_at` | `created_at` | TIMESTAMPTZ | |

**Ключевой момент:** фронтенд почти не видит алиасы. В `/api/orders` backend подменяет `dish_id` на `primary_dish_id`, в `/api/dishes` возвращает `recipe_source_id` с тем же эффектом. UI алиасов нужен только в `RecipeEditor` через `fetchDishAliases()`/`linkDishToAlias()`/`unlinkDishAlias()`.

## IngredientBase (types.ts) ↔ slicer_ingredients

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `id` | `id` | UUID | gen_random_uuid() |
| `name` | `name` | VARCHAR(255) | Название |
| `parentId` | `parent_id` | UUID | FK self-reference |
| `imageUrl` | `image_url` | TEXT | URL или Base64 |
| `unitType` | `unit_type` | VARCHAR(10) | 'kg' \| 'piece' |
| `pieceWeightGrams` | `piece_weight_grams` | NUMERIC(10,2) | Вес 1 штуки в граммах |
| `is_stopped` | `is_stopped` | BOOLEAN | На стопе? |
| `stop_reason` | `stop_reason` | VARCHAR(255) | Причина стопа |
| `stop_timestamp` | `stop_timestamp` | TIMESTAMPTZ | Когда остановлен |
| — | `stopped_by_uuid` | UUID | Актор поставивший стоп (миграция 014) |
| — | `stopped_by_name` | VARCHAR(255) | Имя актора (миграция 014) |
| `bufferPercent` | `buffer_percent` | NUMERIC(5,2) | Надбавка % для брутто (миграция 010) |

## Category (types.ts) ↔ slicer_categories

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `id` | `id` | UUID | gen_random_uuid() |
| `name` | `name` | VARCHAR(255) | Название |
| `sort_index` | `sort_index` | INT | 0 = VIP (наивысший) |

## SystemSettings (types.ts) ↔ slicer_settings

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `aggregationWindowMinutes` | `aggregation_window_minutes` | INT | Default: 5 |
| `historyRetentionMinutes` | `history_retention_minutes` | INT | Default: 15 |
| `activePriorityRules` | `active_priority_rules` | JSONB | `["ULTRA","COURSE_FIFO"]` |
| `courseWindowSeconds` | `course_window_seconds` | INT | Default: 10 |
| `restaurantOpenTime` | `restaurant_open_time` | VARCHAR(5) | "12:00" |
| `restaurantCloseTime` | `restaurant_close_time` | VARCHAR(5) | "23:59" |
| `excludedDates` | `excluded_dates` | JSONB | `["2026-04-09"]` |
| `enableAggregation` | `enable_aggregation` | BOOLEAN | Default: false |
| `enableSmartAggregation` | `enable_smart_aggregation` | BOOLEAN | Default: true |
| `enableKdsStoplistSync` | `enable_kds_stoplist_sync` | BOOLEAN | Default: false (миграция 006) |
| `defrostDurationMinutes` | `defrost_duration_minutes` | INT | Default: 15, CHECK 1..60 (миграция 016) |
| `enableDefrostSound` | `enable_defrost_sound` | BOOLEAN | Default: true (миграция 016) |
| `dessertCategoryId` | `dessert_category_id` | UUID | FK → slicer_categories(id) (миграция 017) |
| `dessertAutoParkEnabled` | `dessert_auto_park_enabled` | BOOLEAN | Default: false (миграция 017) |
| `dessertAutoParkMinutes` | `dessert_auto_park_minutes` | INT | Default: 40, CHECK 1..240 (миграция 017) |

## OrderHistoryEntry (types.ts) ↔ slicer_order_history

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `id` | `id` | UUID | gen_random_uuid() |
| `dishId` | `dish_id` | VARCHAR(255) | ctlg15_dishes.suuid |
| `dishName` | `dish_name` | VARCHAR(255) | Сохраняем имя на момент завершения |
| `completedAt` | `completed_at` | TIMESTAMPTZ | Когда завершён |
| `totalQuantity` | `total_quantity` | INT | Кол-во порций |
| `prepTimeMs` | `prep_time_ms` | BIGINT | Время приготовления мс |
| `was_parked` | `was_parked` | BOOLEAN | Для разделения KPI |
| `snapshot` | `snapshot` | JSONB | Полный объект Order |
| `consumedIngredients` | `consumed_ingredients` | JSONB | `[{id,name,unitType,quantity,weightGrams}]` |

## StopHistoryEntry (types.ts) ↔ slicer_stop_history

| TypeScript поле | DB колонка | Тип DB | Примечание |
|---|---|---|---|
| `id` | `id` | UUID | gen_random_uuid() |
| `ingredientName` | `target_name` | VARCHAR(255) | Имя ингредиента или "[DISH] Блюдо" |
| — | `target_type` | VARCHAR(20) | 'ingredient' \| 'dish' |
| — | `target_id` | VARCHAR(255) | UUID ингредиента или блюда |
| `stoppedAt` | `stopped_at` | TIMESTAMPTZ | Начало стопа |
| `resumedAt` | `resumed_at` | TIMESTAMPTZ | Конец стопа |
| `reason` | `reason` | VARCHAR(255) | Причина |
| `durationMs` | `duration_ms` | BIGINT | Вычисляется при resume |
| `stoppedByUuid` | `stopped_by_uuid` | UUID | Актор поставивший стоп (миграция 014) |
| `stoppedByName` | `stopped_by_name` | VARCHAR(255) | Имя актора поставившего стоп (миграция 014) |
| `resumedByUuid` | `resumed_by_uuid` | UUID | Актор снявший стоп (миграция 014) |
| `resumedByName` | `resumed_by_name` | VARCHAR(255) | Имя актора снявшего стоп (миграция 014) |
| `actorSource` | `actor_source` | VARCHAR(20) | `'slicer'` / `'kds'` / `'cascade'` (миграция 014) |

## Order.parked_by_auto и effective_created_at

Дополнительные поля Order добавлены в миграции 018 (Вариант Б парковки) — подробный маппинг см. в первой таблице выше и в [tables/slicer_order_state.md](tables/slicer_order_state.md).
