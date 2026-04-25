# BD_docs — Документация базы данных модуля Slicer

## Обзор архитектуры

Модуль нарезчика (Slicer Station) работает с существующей PostgreSQL БД основной KDS-системы (`arclient`) и добавляет 15 собственных таблиц с префиксом `slicer_`.

### Подключение к БД
- **Host:** localhost
- **Port:** 5432
- **Database:** arclient
- **User:** postgres
- **Password:** 1234

### Принцип работы
- **Существующие таблицы** (`docm2_*`, `ctlg*`, `rgst*`) — **только ЧТЕНИЕ** по умолчанию. Опциональная запись только в `rgst3_dishstoplist` при включённой двусторонней синхронизации стоп-листа.
- **Таблицы slicer_*** — полный CRUD (создание, чтение, обновление, удаление)

## Схема связей (ER-диаграмма)

```
┌─────────────────────┐      ┌──────────────────────┐
│   docm2_orders      │      │  ctlg13_halltables   │
│   (заказы KDS)      │◄─────│  (столы)             │
│                     │      │  ctlg13_tablenumber   │
│  suuid ─────────┐   │      └──────────────────────┘
└─────────────────│───┘
                  │
                  ▼ owner
┌─────────────────────┐      ┌──────────────────────┐
│ docm2tabl1_items    │      │   ctlg15_dishes      │
│ (позиции заказа)    │─────►│   (блюда KDS)        │
│                     │dish  │                      │
│  suuid ─────────┐   │      │  suuid ──────┐       │
└─────────────────│───┘      └──────────────│───────┘
                  │                         │
                  ▼                         ▼ dish_id
┌─────────────────────┐      ┌──────────────────────┐
│ slicer_order_state  │      │  slicer_recipes      │
│ (парковка, статус)  │      │  (рецепт: блюдо →    │
│                     │      │   ингредиент + кол-во)│
└─────────────────────┘      │                      │
                             │  ingredient_id ──┐   │
         ┌───────────────────┘                  │   │
         │                                      ▼   │
         │               ┌──────────────────────┐   │
         │               │ slicer_ingredients   │   │
         │               │ (справочник, иерархия│   │
         │               │  parent→child, стоп) │   │
         │               │                      │   │
         │               │  parent_id → self FK │   │
         │               └──────────┬───────────┘
         │                          │
         │                          ▼
         │               ┌──────────────────────────┐
         │               │ slicer_ingredient_       │
         │               │ consumption              │
         │               │ (расход при завершении)  │
         │               └──────────────────────────┘
         │
         ▼ dish_id
┌─────────────────────┐
│ slicer_order_history│
│ (KPI, snapshot,     │
│  consumed_ingr.)    │
└─────────────────────┘

┌─────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│ slicer_categories   │  │ slicer_stop_history  │  │ slicer_settings    │
│ (sort_index)        │  │ (длительность стопов)│  │ (singleton,        │
│                     │  │                      │  │  все настройки)    │
└─────────────────────┘  └──────────────────────┘  └────────────────────┘
```

## Список таблиц

### Существующие (KDS) — только чтение:
- [docm2_orders](existing_tables.md#docm2_orders) — Заказы
- [docm2tabl1_items](existing_tables.md#docm2tabl1_items) — Позиции заказов
- [ctlg15_dishes](existing_tables.md#ctlg15_dishes) — Блюда
- [ctlg13_halltables](existing_tables.md#ctlg13_halltables) — Столы
- [ctlg14_shifts](existing_tables.md#ctlg14_shifts) — Смены
- [ctlg18_menuitems](existing_tables.md#ctlg18_menuitems) — Пункты меню (связь блюдо→склад)
- [ctlg17_storages](existing_tables.md#ctlg17_storages) — Склады-цеха (фильтр по цехам для нарезчика)
- [rgst3_dishstoplist](existing_tables.md#rgst3_dishstoplist) — Стоп-лист блюд

### Таблицы модуля (slicer_*):
- [slicer_categories](tables/slicer_categories.md) — Категории с порядком сортировки
- [slicer_dish_categories](tables/slicer_dish_categories.md) — Ручное назначение slicer-категорий блюдам (dish_id→category_id)
- [slicer_ingredients](tables/slicer_ingredients.md) — Справочник ингредиентов
- [slicer_recipes](tables/slicer_recipes.md) — Рецепты (блюдо→ингредиент)
- [slicer_dish_aliases](tables/slicer_dish_aliases.md) — Алиасы блюд (общий рецепт для вариантов)
- [slicer_dish_stoplist](tables/slicer_dish_stoplist.md) — Актуальный стоп-лист блюд (MANUAL + CASCADE)
- [slicer_dish_images](tables/slicer_dish_images.md) — Фото блюд (путь до файла на диске)
- [slicer_dish_priority](tables/slicer_dish_priority.md) — Per-dish приоритет (NORMAL/ULTRA), миграция 013
- [slicer_dish_defrost](tables/slicer_dish_defrost.md) — Per-dish флаг «требует разморозки?», миграция 016
- [slicer_kds_sync_config](tables/slicer_kds_sync_config.md) — Конфиг двусторонней синхронизации с rgst3 (миграция 006)
- [slicer_order_state](tables/slicer_order_state.md) — Состояние заказов нарезчика
- [slicer_order_history](tables/slicer_order_history.md) — История завершённых заказов
- [slicer_ingredient_consumption](tables/slicer_ingredient_consumption.md) — Расход ингредиентов
- [slicer_stop_history](tables/slicer_stop_history.md) — История стоп-листа
- [slicer_settings](tables/slicer_settings.md) — Настройки модуля (singleton)

## Миграции
- [001_create_slicer_tables](migrations/001_create_slicer_tables.md) — Создание 8 базовых таблиц
- [002_seed_defaults](migrations/002_seed_defaults.md) — Начальные данные (настройки, категории)
- [003_dish_aliases](migrations/003_dish_aliases.md) — Таблица алиасов блюд
- [004_dish_categories](migrations/004_dish_categories.md) — Таблица ручного назначения категорий блюдам
- [005_dish_stoplist](migrations/005_dish_stoplist.md) — Каскадный стоп-лист блюд
- [006_kds_stoplist_sync](migrations/006_kds_stoplist_sync.md) — Двусторонняя синхронизация с rgst3 (OFF по умолчанию)
- [007_slicer_finished_at](migrations/007_slicer_finished_at.md) — Колонка finished_at для метрики «Скорость готовки повара»
- [008_dish_images](migrations/008_dish_images.md) — Таблица фото блюд (путь на диске)
- [009_ingredient_images_filesystem](migrations/009_ingredient_images_filesystem.md) — Фото ингредиентов с Base64 на файлы на диске
- [010_ingredient_buffer_percent](migrations/010_ingredient_buffer_percent.md) — Колонка buffer_percent для +% в Dashboard
- [011_rgst3_archive_trigger](migrations/011_rgst3_archive_trigger.md) — BEFORE DELETE триггер на rgst3_dishstoplist, архивирует снятия стопов кассиров в slicer_stop_history
- [012_rgst3_archive_with_code](migrations/012_rgst3_archive_with_code.md) — target_name = «code name» в архиве + alias-resolve в GET /history; фикс двойного учёта для пар зал/доставка
- [013_dish_priority](migrations/013_dish_priority.md) — slicer_dish_priority (per-dish NORMAL/ULTRA)
- [014_stop_actor_tracking](migrations/014_stop_actor_tracking.md) — Колонки `stopped_by_*` / `resumed_by_*` / `actor_source` в истории стопов
- [015_rgst3_archive_with_actor](migrations/015_rgst3_archive_with_actor.md) — Функция триггера резолвит `OLD.inserter` через users, пишет `stopped_by_*` + `actor_source='kds'`
- [016_dish_defrost](migrations/016_dish_defrost.md) — Разморозка блюд: таблица slicer_dish_defrost + defrost_* в order_state + настройки duration/sound
- [017_dessert_auto_park](migrations/017_dessert_auto_park.md) — Авто-парковка десертов: dessert_* настройки в slicer_settings
- [018_effective_created_at](migrations/018_effective_created_at.md) — Вариант Б парковки: effective_created_at + parked_by_auto, меняет семантику accumulated_time_ms
- [019_dessert_modifier_trigger](migrations/019_dessert_modifier_trigger.md) — Авто-парковка десертов только при наличии модификатора времени (ctlg20) + поддержка «Готовить к HH.MM»

## Связанные документы
- [mappings.md](mappings.md) — TypeScript interface ↔ DB column маппинг
- [existing_tables.md](existing_tables.md) — Документация существующих таблиц KDS
