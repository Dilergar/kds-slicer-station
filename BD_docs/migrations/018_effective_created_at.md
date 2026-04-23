# Миграция 018 — Вариант Б парковки

**Дата:** 2026-04-23
**Файл:** `server/migrations/018_effective_created_at.sql`

## Цель

Сменить семантику таймера/сортировки так, чтобы:
- **Ручной unpark** возвращал заказ на историческое место в очереди (по ordertime), как если бы парковки не было;
- **Авто-unpark десерта** ставил позицию в конец очереди (как новый заказ);
- **KPI повара (`prepTimeMs`)** корректно исключал время парковки в обоих случаях.

## Изменения

### Новые колонки в `slicer_order_state`

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `effective_created_at` | TIMESTAMPTZ NULL | — | Переопределение точки отсчёта таймера/сортировки. NULL → используется `docm2tabl1_ordertime`. |
| `parked_by_auto` | BOOLEAN NOT NULL | FALSE | Флаг текущей парковки (актуален только пока `status='PARKED'`). |

## Семантика `accumulated_time_ms` (ИЗМЕНЕНА)

**Было (миграции 001–017):** «активное время до парковки» — складывалось при `/park`.
**Стало (миграция 018):** «общее время парковок» — складывается при `/unpark`.

## Формула таймера на клиенте

```ts
const pivot = order.status === 'PARKED' && order.parked_at ? order.parked_at : now;
const elapsed = Math.max(0, (pivot - order.created_at) - (order.accumulated_time_ms || 0));
```

`prepTimeMs` в `handleCompleteOrder`/`handlePartialComplete` — та же формула при `now = момент завершения`.

## Правила backend

| Событие | parked_by_auto | accumulated_time_ms | effective_created_at |
|---|---|---|---|
| Новая позиция (без записи в state) | — | 0 (default) | NULL → фолбэк на ordertime |
| `/park` (ручная) | ← FALSE | не трогаем | не трогаем |
| `/unpark` ручной парковки | → FALSE | += (NOW() − parked_at) | не трогаем |
| `/unpark` авто-парковки | → FALSE | = 0 | = NOW() |
| Авто-парковка десерта в GET | ← TRUE | 0 (default при INSERT) | не трогаем |
| Авто-unpark (`unpark_at ≤ NOW()`), ручная | → FALSE | += (unpark_at − parked_at) | не трогаем |
| Авто-unpark, авто-парковка | → FALSE | = 0 | = unpark_at |
| `/restore` (возврат из истории) | → FALSE | = 0 | = NULL |

## Примеры

### Ручная парковка супа
- 12:00 ordertime, суп приходит. accumulated=0, eff=NULL. Таймер = 0 мин.
- 12:05 нарезчик паркует. parked_at=12:05, accumulated=0. Таймер замирает на 5 мин.
- 12:20 нарезчик жмёт «Вернуть». accumulated += (12:20−12:05) = 15 мин. parked_at=NULL.
- 12:25: pivot=now=12:25, created_at=12:00 (eff=NULL). elapsed = (25−0) − 15 = 10 мин. ✓
- Сортировка по created_at=12:00 → суп идёт перед заказами позже 12:00.

### Авто-парковка десерта
- 12:00 заказ. auto-park INSERT: parked_at=12:00, unpark_at=12:40, parked_by_auto=TRUE.
- 12:05 нарезчик смотрит — десерт в панели парковки с таймером до 12:40.
- 12:40 auto-unpark в GET: accumulated=0, eff=12:40, parked_by_auto=FALSE, parked_at=NULL.
- 12:45: pivot=now=12:45, created_at=12:40. elapsed = (45−40) − 0 = 5 мин. ✓
- Сортировка по created_at=12:40 → десерт встаёт после заказов 12:38 и раньше.

### Ручной unpark автопарковки (гость сказал «несите уже»)
- 12:00 заказ. auto-park: parked_at=12:00, parked_by_auto=TRUE.
- 12:10 нарезчик жмёт «Вернуть».
- Backend: parked_by_auto=TRUE → accumulated=0, eff=NOW()=12:10.
- 12:15: elapsed = (15−10) − 0 = 5 мин. ✓
- Сортировка по 12:10 → десерт в конец очереди.

## Rollback

```sql
ALTER TABLE slicer_order_state
  DROP COLUMN IF EXISTS effective_created_at,
  DROP COLUMN IF EXISTS parked_by_auto;
```

Семантика `accumulated_time_ms` после rollback остаётся «общее время парковок» — чтобы вернуть старую семантику, потребуется пересчитать значения или откатить до 017 и раньше.
