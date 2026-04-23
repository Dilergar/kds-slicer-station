# Миграция 017 — Авто-парковка десертов

**Дата:** 2026-04-23
**Файл:** `server/migrations/017_dessert_auto_park.sql`

## Цель

Десерты официанты заказывают сразу со всем столом, но готовить их нужно через 30–40 минут — гости сами сигналят когда принести. Без авто-парковки карточка десерта сразу падает в очередь нарезчика и сбивает FIFO + COURSE_FIFO (идёт после горячего, хотя по времени пришла с салатом).

Решение: при первом появлении дессертной позиции в `GET /api/orders` она сразу уходит в `PARKED` со временем авто-возврата `docm2tabl1_ordertime + X минут`. Нарезчик может вернуть её раньше вручную как любую другую парковку.

## Изменения

### `slicer_settings` — добавлены три колонки

| Колонка | Тип | Default | Назначение |
|---|---|---|---|
| `dessert_category_id` | UUID NULL, FK → `slicer_categories(id)` ON DELETE SET NULL | — | К какой категории применяется правило. NULL = правило отключено. |
| `dessert_auto_park_enabled` | BOOLEAN NOT NULL | FALSE | Глобальный тумблер. Правило не срабатывает пока FALSE. |
| `dessert_auto_park_minutes` | INT NOT NULL, CHECK 1..240 | 40 | На сколько минут парковать от `ordertime`. |

### Seed

Если категория с именем «Десерты» / «Dessert» / «Desserts» (без учёта регистра) уже существует — `dessert_category_id` автоматически на неё привязывается. Если нет — поле остаётся NULL, админ настраивает вручную потом.

### Защита от удаления

FK с `ON DELETE SET NULL` — БД сама не блокирует, но backend маршрут `DELETE /api/categories/:id` отказывает с `409 Conflict` если id совпадает с `dessert_category_id`. Так мы не ломаем правило настраиваемой категории и при этом сохраняем целостность если категория всё же удаляется через прямой SQL.

## Где срабатывает правило

`server/src/routes/orders.ts` — `GET /api/orders`. После резолва алиасов и whitelist'а цехов, для каждой строки без записи в `slicer_order_state` проверяется:

1. `dessert_auto_park_enabled = TRUE`?
2. `dessert_category_id IS NOT NULL`?
3. Каноническое блюдо (после alias-резолва) назначено на эту категорию в `slicer_dish_categories`?

Если все три — INSERT в `slicer_order_state`:
- `status = 'PARKED'`
- `parked_at = ordertime`
- `unpark_at = ordertime + dessert_auto_park_minutes * INTERVAL '1 minute'`
- `was_parked = TRUE`
- `parked_tables` = столы из заказа

Авто-разпарковка в том же `GET /api/orders` (блок сверху, `unpark_at <= NOW()`) снимет парковку автоматически когда время подойдёт — нарезчик не должен нажимать «Вернуть».

## Семантика `was_parked` и KPI

`was_parked = TRUE` ставится при авто-парковке — для KPI-отчётов дессертные позиции будут помечены как «были паркованы», даже если нарезчик ни разу не нажимал парковку вручную. Это корректно: между заказом и нарезкой прошла намеренная пауза, измерять её как «время готовки» неверно. `accumulated_time_ms` копится только при ручной парковке/распарковке (см. `park`/`unpark` маршруты) — для авто-парковки не трогаем, потому что таймер всё равно стартует с нуля при попадании в очередь.

## Rollback

```sql
ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_dessert_category_fk,
  DROP CONSTRAINT IF EXISTS slicer_settings_dessert_auto_park_minutes_valid,
  DROP COLUMN IF EXISTS dessert_category_id,
  DROP COLUMN IF EXISTS dessert_auto_park_enabled,
  DROP COLUMN IF EXISTS dessert_auto_park_minutes;
```

Существующие `slicer_order_state` строки после отката останутся с правильными значениями (auto-park продолжит работать как обычная парковка, только новые не будут создаваться).
