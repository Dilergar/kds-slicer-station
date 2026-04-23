# Миграция 001: Создание таблиц модуля нарезчика

## Дата выполнения
2026-04-10

## Файл
`server/migrations/001_create_slicer_tables.sql`

## Что делает
Создаёт 8 таблиц с префиксом `slicer_` в существующей БД `arclient`:

1. `slicer_categories` — категории с sort_index
2. `slicer_ingredients` — ингредиенты с иерархией и стоп-листом
3. `slicer_recipes` — рецепты (блюдо → ингредиент + граммовка)
4. `slicer_order_state` — состояние заказов нарезчика (парковка, статус)
5. `slicer_order_history` — история завершённых заказов (KPI)
6. `slicer_ingredient_consumption` — расход ингредиентов
7. `slicer_stop_history` — история стоп-листа
8. `slicer_settings` — настройки (singleton)

## Созданные индексы
- `idx_slicer_ingredients_parent` — поиск детей по parent_id
- `idx_slicer_ingredients_stopped` — частичный, остановленные ингредиенты
- `idx_slicer_recipes_dish` — поиск рецепта по dish_id
- `idx_slicer_order_state_status` — фильтрация по статусу
- `idx_slicer_order_state_unpark` — частичный, для авто-разпарковки
- `idx_slicer_order_history_time` — фильтрация по дате
- `idx_slicer_order_history_parked` — разделение KPI
- `idx_slicer_consumption_ingredient` — агрегация по ингредиенту
- `idx_slicer_consumption_order` — связь с историей
- `idx_slicer_stop_history_target` — поиск по target_id
- `idx_slicer_stop_history_time` — фильтрация по дате

## Зависимости
- Расширение `uuid-ossp` (создаётся автоматически если не существует)
- НЕ зависит от существующих таблиц KDS (все FK внутри slicer_*)

## Как выполнить на продакшне
```bash
PGPASSWORD=<пароль> psql -U postgres -d arclient -f server/migrations/001_create_slicer_tables.sql
```

## Откат (если нужно)
```sql
DROP TABLE IF EXISTS slicer_ingredient_consumption CASCADE;
DROP TABLE IF EXISTS slicer_order_history CASCADE;
DROP TABLE IF EXISTS slicer_stop_history CASCADE;
DROP TABLE IF EXISTS slicer_order_state CASCADE;
DROP TABLE IF EXISTS slicer_recipes CASCADE;
DROP TABLE IF EXISTS slicer_ingredients CASCADE;
DROP TABLE IF EXISTS slicer_categories CASCADE;
DROP TABLE IF EXISTS slicer_settings CASCADE;
```
