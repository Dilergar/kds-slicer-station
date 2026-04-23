# Миграция 013 — `slicer_dish_priority`

**Дата:** 2026-04-19
**Файл:** `server/migrations/013_dish_priority.sql`

## Цель

Персистировать per-dish приоритет (`NORMAL` / `ULTRA`), который нарезчик выставляет в `RecipeEditor`. До этой миграции `priority_flag` в `GET /api/dishes` был захардкожен в `1` — тогл в UI менял только локальный стейт компонента и сбрасывался при перезагрузке.

## Новая таблица `slicer_dish_priority`

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `dish_id` | TEXT PK | — | `ctlg15_dishes.suuid` (без FK — чужая таблица). |
| `priority_flag` | INTEGER NOT NULL, CHECK IN (1, 3) | 1 | `1=NORMAL`, `3=ULTRA`. Соответствует enum `PriorityLevel` в `types.ts`. |
| `updated_at` | TIMESTAMPTZ NOT NULL | NOW() | |

Отсутствие записи = `NORMAL` (дефолт через `COALESCE` в `GET /api/dishes`). UPSERT при save, DELETE при сбросе slicer-data.

## Семантика alias vs primary

В отличие от `slicer_dish_aliases` / `slicer_recipes` (где значение наследуется от primary), **priority хранится per-dish**: у `163 Баклажаны` и `Д163 Баклажаны` могут быть разные приоритеты, так как в UI они показываются отдельными карточками и нарезчик может отметить ULTRA только для одной из них.

## API

- `GET /api/dishes` — возвращает `priority_flag` для каждого блюда (через LEFT JOIN на `slicer_dish_priority`).
- `PUT /api/dishes/:dishId/priority` — UPSERT `{priority_flag: 1 | 3}`. RecipeEditor вызывает при сохранении формы блюда.

## Rollback

```sql
DROP TABLE IF EXISTS slicer_dish_priority;
```
