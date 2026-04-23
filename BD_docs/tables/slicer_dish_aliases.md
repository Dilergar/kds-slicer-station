# slicer_dish_aliases

## Назначение
Маппинг "блюдо-алиас → блюдо-primary". Решает проблему вариантов одного логического блюда: например `163 Баклажаны` (зал) и `Д163 Баклажаны` (доставка) — для нарезчика это одно и то же блюдо, но в `ctlg15_dishes` они записаны как две разных позиции с разными `suuid`.

Алиас означает: "это блюдо использует рецепт другого блюда". При запросе заказов (`GET /api/orders`) и справочника блюд (`GET /api/dishes`) backend резолвит алиасы автоматически, фронтенд не знает об этой логике.

## Почему отдельная таблица
- `ctlg15_dishes` — чужая таблица, нельзя добавлять поля
- Концепция "primary/alias" — специфична для нарезчика, кассе не нужна
- Префикс `slicer_` изолирует от основной KDS-схемы

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `alias_dish_id` | VARCHAR(255) | ✅ | — | **PRIMARY KEY**. suuid блюда-алиаса (например Д163). Тип VARCHAR а не UUID — так как это "теневая" ссылка на `ctlg15_dishes.suuid`, без формального FK (правило не трогать чужие таблицы) |
| `primary_dish_id` | VARCHAR(255) | ✅ | — | suuid блюда-primary (например 163), у которого есть рецепт в `slicer_recipes` |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания связи |

## Ключевое ограничение
`alias_dish_id` — PRIMARY KEY → одно блюдо может быть алиасом **только одного** primary. Это означает "одно блюдо = один рецепт" и предотвращает неопределённость при резолве рецепта.

## Индексы

| Имя | Колонки | Назначение |
|---|---|---|
| `idx_slicer_dish_aliases_primary` | `primary_dish_id` | Быстрый поиск всех алиасов конкретного primary (для UI "связанные варианты") |

## Foreign Keys
**Нет FK.** Обе колонки — "теневые" ссылки на `ctlg15_dishes.suuid` (чужая таблица, нельзя создавать FK). На уровне приложения должен быть fallback если primary удалён из `ctlg15_dishes`.

## Связанные таблицы
- `ctlg15_dishes` (чужая) — оба UUID ссылаются сюда
- `slicer_recipes.dish_id` — хранит рецепт primary блюда. Рецепт автоматически применяется ко всем алиасам через JOIN

## Алгоритм резолва (SQL)

### В `GET /api/dishes` — резолв ингредиентов:
```sql
SELECT d.suuid AS id, d.name, d.code,
       COALESCE(alias.primary_dish_id, d.suuid::text) AS recipe_source_id
FROM ctlg15_dishes d
LEFT JOIN slicer_dish_aliases alias ON alias.alias_dish_id = d.suuid::text
WHERE d.isfolder = false;
-- Затем ингредиенты подтягиваются из slicer_recipes WHERE dish_id = recipe_source_id
```

### В `GET /api/orders` — подмена dish_id:
```sql
SELECT
  items.suuid AS item_id,
  -- Подмена: если есть алиас → primary, иначе оригинал
  COALESCE(alias.primary_dish_id::uuid, items.docm2tabl1_ctlg15_uuid__dish) AS dish_id,
  COALESCE(primary_dish.name, dishes.name) AS dish_name
FROM docm2tabl1_items items
INNER JOIN ctlg15_dishes dishes ON dishes.suuid = items.docm2tabl1_ctlg15_uuid__dish
LEFT JOIN slicer_dish_aliases alias
  ON alias.alias_dish_id = items.docm2tabl1_ctlg15_uuid__dish::text
LEFT JOIN ctlg15_dishes primary_dish
  ON primary_dish.suuid::text = alias.primary_dish_id;
```

**Результат:** фронтенд видит заказы `Д163` и `163` как будто оба с `dish_id = 163`. `smartQueue.ts` агрегирует их как одно блюдо без единой строчки изменений.

## Примеры SQL

### Создать алиас (связать Д163 → 163):
```sql
INSERT INTO slicer_dish_aliases (alias_dish_id, primary_dish_id)
VALUES ('6691c5ca-dcd9-4bc7-aff0-f67b5a8fc37e', '651e2a4f-b1e7-4779-99fb-a49b4145e5c9')
ON CONFLICT (alias_dish_id) DO UPDATE SET primary_dish_id = EXCLUDED.primary_dish_id;
```

### Получить все алиасы конкретного primary:
```sql
SELECT a.alias_dish_id, d.name, d.code
FROM slicer_dish_aliases a
JOIN ctlg15_dishes d ON d.suuid::text = a.alias_dish_id
WHERE a.primary_dish_id = '651e2a4f-b1e7-4779-99fb-a49b4145e5c9';
```

### Удалить алиас (вернуть блюдо в independent):
```sql
DELETE FROM slicer_dish_aliases WHERE alias_dish_id = '6691c5ca-dcd9-4bc7-aff0-f67b5a8fc37e';
```

## API эндпоинты
- `GET /api/dish-aliases` — список всех алиасов
- `POST /api/dish-aliases` — создать/обновить (UPSERT). Body: `{alias_dish_id, primary_dish_id}`
- `DELETE /api/dish-aliases/:alias_dish_id` — удалить
