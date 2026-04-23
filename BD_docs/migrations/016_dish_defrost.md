# Миграция 016 — Разморозка блюд

**Дата:** 2026-04-23
**Файл:** `server/migrations/016_dish_defrost.sql`

## Цель

Добавить поддержку блюд, которые перед нарезкой должны разморозиться (по текущему бизнесу — только рыба). Нарезчик запускает таймер разморозки кликом по ❄️-иконке на карточке, карточка сворачивается в мини-карточку в верхней «зоне разморозки» и возвращается в очередь после истечения таймера (или по ручному подтверждению «Разморозилась»). После разморозки ULTRA-приоритет теряется — блюдо встаёт в очередь по FIFO+категории, как если бы ULTRA не было изначально.

## Изменения

### 1. `slicer_settings` — добавлены колонки

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `defrost_duration_minutes` | INT NOT NULL | 15 | Время разморозки в минутах (CHECK 1..60). Одно значение на все блюда. |
| `enable_defrost_sound` | BOOLEAN NOT NULL | TRUE | Играть Web Audio beep когда таймер мини-карточки достиг 0. |

### 2. `slicer_dish_defrost` — новая таблица

Per-dish флаг «блюдо требует разморозки?».

| Колонка | Тип | Назначение |
|---|---|---|
| `dish_id` | TEXT PK | `ctlg15_dishes.suuid` (TEXT, без FK — чужая таблица). |
| `requires_defrost` | BOOLEAN NOT NULL DEFAULT FALSE | Если TRUE — на KDS-карточке показывается ❄️-кнопка. |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

Значение берётся по primary-блюду через `recipe_source_id` (как рецепт) — алиасы наследуют. Записывается всегда на primary: `RecipeEditor.saveDishForm` резолвит `dishId → aliasMap → primary` перед `PUT /api/dishes/:id/defrost`.

### 3. `slicer_order_state` — добавлены колонки

| Колонка | Тип | Назначение |
|---|---|---|
| `defrost_started_at` | TIMESTAMPTZ NULL | Момент клика по ❄️. NULL = разморозка не запускалась. |
| `defrost_duration_seconds` | INT NULL | Snapshot `defrost_duration_minutes*60` в момент запуска. Нужен чтобы изменение глобальной настройки не сбивало уже запущенные таймеры. |

Индекс `idx_slicer_order_state_defrost_active` — частичный, только на строки с `defrost_started_at IS NOT NULL`.

## Семантика состояний

```
defrost_started_at IS NULL
  → ожидание, карточка в очереди, ❄️ кликабельная (голубая, pulse)

defrost_started_at IS NOT NULL AND NOW() < started + duration*sec
  → в процессе, мини-карточка в DefrostRow над основной сеткой
    в основной очереди не показывается (flattenOrders пропускает)

defrost_started_at IS NOT NULL AND NOW() >= started + duration*sec
  → разморожено, карточка снова в основной очереди
    ULTRA лишён (smartQueue: hasDefrostBeenStarted → NORMAL)
    на карточке статичная серая ❄️ — индикатор «проходило разморозку»
```

## Ручное подтверждение «Разморозилась»

Когда нарезчик видит, что рыба оттаяла раньше таймера, в модалке `DefrostModal` жмёт большую зелёную кнопку. Бэкенд не заводит отдельную колонку «вручную завершено» — вместо этого сдвигает `defrost_started_at` в прошлое:

```sql
defrost_started_at = NOW() - (COALESCE(defrost_duration_seconds, 0) + 1) * INTERVAL '1 second'
```

После этого `NOW() - started_at >= duration` → таймер истёк, карточка возвращается в очередь. `defrost_started_at` остаётся `NOT NULL`, значит ULTRA по-прежнему лишён.

## Сброс defrost-state

Defrost-поля (`defrost_started_at`, `defrost_duration_seconds`) обнуляются в двух местах:
- `POST /api/orders/:id/park` — парковка доминирует, старая разморозка теряет смысл.
- `POST /api/orders/:id/restore` — восстановленный из истории заказ начинает с чистого листа.

После `/defrost-cancel` они также сбрасываются, но сам статус заказа не трогается.

## Новые API endpoints

- `POST /api/orders/:id/defrost-start` — Body `{sourceOrderItemIds?: string[]}`. Snapshot duration из `slicer_settings`, UPSERT в `slicer_order_state` для всех переданных items одной транзакцией. Для Smart Wave передаётся массив, для стандартного — берётся `:id`.
- `POST /api/orders/:id/defrost-cancel` — сбрасывает `defrost_started_at`/`defrost_duration_seconds` в NULL.
- `POST /api/orders/:id/defrost-complete` — бэкдейтит `defrost_started_at` (см. выше).
- `PUT /api/dishes/:dishId/defrost` — Body `{requires_defrost: boolean}`. UPSERT в `slicer_dish_defrost`.

## Порядок применения

```bash
cd server
psql -U postgres -d arclient -f migrations/016_dish_defrost.sql
```

Идемпотентна: все ALTER/CREATE с `IF NOT EXISTS` / `IF EXISTS`, повторный запуск безопасен.

## Откат (rollback)

Обратной миграции нет. При необходимости отката вручную:

```sql
DROP INDEX IF EXISTS idx_slicer_order_state_defrost_active;
ALTER TABLE slicer_order_state
  DROP COLUMN IF EXISTS defrost_started_at,
  DROP COLUMN IF EXISTS defrost_duration_seconds;

DROP TABLE IF EXISTS slicer_dish_defrost;

ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_defrost_duration_valid,
  DROP COLUMN IF EXISTS defrost_duration_minutes,
  DROP COLUMN IF EXISTS enable_defrost_sound;
```
