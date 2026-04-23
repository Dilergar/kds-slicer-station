# Миграция 004: slicer_dish_categories

**Файл**: `server/migrations/004_dish_categories.sql`
**Дата**: 2026-04-13

## Что делает

Создаёт таблицу [slicer_dish_categories](../tables/slicer_dish_categories.md) — ручное назначение slicer-категорий блюдам из `ctlg15_dishes`. Плюс индекс `idx_slicer_dish_categories_dish` для поиска по `dish_id`.

## Зачем

До этой миграции `GET /api/dishes` в [server/src/routes/dishes.ts](../../server/src/routes/dishes.ts) использовал костыль: всем блюдам присваивалась первая категория из `slicer_categories` (без `ORDER BY`). Так как сид [002_seed_defaults.sql](../../server/migrations/002_seed_defaults.sql) инсертит VIP первым, все блюда помечались как VIP. В `RecipeEditor.tsx` VIP-блок отфильтрован → страница «Рецепты» была пустой.

После миграции маппинг `ctlg15_ctlg38_uuid__goodcategory → slicer_categories.id` больше не нужен. Нарезчик сам назначает категорию через UI при редактировании рецепта — это хранится здесь.

## Чужие таблицы не затрагиваются

Только новая таблица `slicer_*`. Соответствует правилу CLAUDE.md «БД arclient неприкосновенна».

## Как применить

```bash
cd server
psql -U postgres -d arclient -f migrations/003_dish_categories.sql
```

Ожидаемый вывод:
```
CREATE TABLE
CREATE INDEX
```

## Откат

```sql
DROP TABLE IF EXISTS slicer_dish_categories;
```
