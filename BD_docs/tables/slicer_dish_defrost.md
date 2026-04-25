# Таблица `slicer_dish_defrost`

**Миграции:** `016_dish_defrost.sql` (создание), `020_per_dish_defrost_duration.sql` (добавление `defrost_duration_minutes`)
**Создана:** 2026-04-23

## Назначение

Per-dish флаг «блюдо требует разморозки перед нарезкой?» + per-dish длительность таймера в минутах. Если `requires_defrost = TRUE` — в KDS на карточке этого блюда показывается кликабельная ❄️-кнопка запуска таймера разморозки на `defrost_duration_minutes` минут.

Миграция 020 перенесла длительность с глобальной настройки `slicer_settings.defrost_duration_minutes` (удалена) на per-dish уровень — разные замороженные блюда могут требовать разного времени.

## Структура

| Колонка | Тип | NOT NULL | DEFAULT | Миграция | Описание |
|---|---|---|---|---|---|
| `dish_id` | TEXT | ✓ (PK) | — | 016 | `ctlg15_dishes.suuid`. TEXT без FK — чужая таблица. |
| `requires_defrost` | BOOLEAN | ✓ | `FALSE` | 016 | Если TRUE — карточка блюда на KDS получает ❄️. |
| `defrost_duration_minutes` | INT | ✓ | `15` | 020 | Длительность таймера в минутах. CHECK 1..60. |
| `updated_at` | TIMESTAMPTZ | ✓ | `NOW()` | 016 | Трек-поле. |

**Constraints:**
- `slicer_dish_defrost_duration_valid` — `CHECK (defrost_duration_minutes BETWEEN 1 AND 60)` (020)

Индексов кроме PK нет — таблица маленькая (ожидаемый объём: единицы-десятки строк на ресторан).

## Связи

**Нет формальных FK** (правило CLAUDE.md — чужие таблицы не трогаем). Логическая связь:

- `dish_id` → `ctlg15_dishes.suuid` (чужая таблица, read-only для модуля)

На чтении в `GET /api/dishes` значение резолвится **через `recipe_source_id`** (как рецепт):

```sql
SELECT COALESCE(dd.requires_defrost, false)
FROM ctlg15_dishes d
LEFT JOIN slicer_dish_aliases alias ON alias.alias_dish_id = d.suuid::text
LEFT JOIN slicer_dish_defrost dd    ON dd.dish_id = COALESCE(alias.primary_dish_id, d.suuid::text)
```

Смысл: флаг хранится на **primary-блюде**, алиасы (`alias.primary_dish_id`) наследуют автоматически. Это тот же паттерн, что и для рецепта (`slicer_recipes`): «общий рецепт — общий флаг разморозки».

## Откуда INSERT/UPDATE

Единственный источник записи — `PUT /api/dishes/:dishId/defrost` (роут в `server/src/routes/dishes.ts`), который UPSERT'ит по `dish_id`:

```sql
INSERT INTO slicer_dish_defrost (dish_id, requires_defrost, defrost_duration_minutes)
VALUES ($1, $2, $3)
ON CONFLICT (dish_id) DO UPDATE SET
  requires_defrost = $2,
  defrost_duration_minutes = $3,
  updated_at = NOW();
```

Вызывается из `RecipeEditor.saveDishForm()`: перед запросом `dishId` резолвится в primary через `aliasMap`, то есть запись всегда ложится на primary-блюдо, даже если юзер открыл редактор алиаса. Алиас при этом наследует значение автоматически. Если клиент не передал `defrost_duration_minutes` — бэкенд подставит дефолт 15.

## Откуда DELETE

`DELETE /api/dishes/:dishId/slicer-data` (сброс slicer-данных блюда в RecipeEditor, кнопка «Сбросить рецепт») также чистит запись из этой таблицы в одной транзакции вместе с `slicer_recipes`, `slicer_dish_categories`, `slicer_dish_aliases`, `slicer_dish_priority`.

## Примеры

### Включить разморозку для «127 Рыба в кисло-сладком соусе» (20 минут):

```sql
-- dish_id — это ctlg15_dishes.suuid блюда
INSERT INTO slicer_dish_defrost (dish_id, requires_defrost, defrost_duration_minutes)
VALUES ('a3f2b1e4-...', TRUE, 20)
ON CONFLICT (dish_id) DO UPDATE SET
  requires_defrost = TRUE,
  defrost_duration_minutes = 20,
  updated_at = NOW();
```

### Проверить какие блюда требуют разморозки и сколько минут:

```sql
SELECT d.name, dd.requires_defrost, dd.defrost_duration_minutes, dd.updated_at
FROM slicer_dish_defrost dd
JOIN ctlg15_dishes d ON d.suuid::text = dd.dish_id
WHERE dd.requires_defrost = TRUE
ORDER BY d.name;
```

### Для Smart Wave: какие активные заказы сейчас размораживаются:

```sql
SELECT s.order_item_id,
       s.defrost_started_at,
       s.defrost_duration_seconds,
       (s.defrost_started_at + (s.defrost_duration_seconds || ' seconds')::interval) AS expires_at
FROM slicer_order_state s
WHERE s.defrost_started_at IS NOT NULL
  AND NOW() < s.defrost_started_at + (s.defrost_duration_seconds || ' seconds')::interval
ORDER BY s.defrost_started_at;
```

## Связанные сущности

- `slicer_settings.enable_defrost_sound` — глобальный toggle звукового уведомления при истечении таймера.
- `slicer_order_state.defrost_started_at` / `defrost_duration_seconds` — состояние разморозки для конкретной позиции заказа. `defrost_duration_seconds` — snapshot `defrost_duration_minutes * 60` в момент клика ❄️; изменение настройки блюда после старта не сбивает таймер уже запущенной разморозки.
