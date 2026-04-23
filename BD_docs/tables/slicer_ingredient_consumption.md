# slicer_ingredient_consumption

## Назначение
Расход ингредиентов при завершении заказов. Используется для SQL-агрегации в отчёте "Ingredient Usage" на Dashboard. Отдельная таблица (не только JSONB в slicer_order_history) для эффективных GROUP BY запросов.

## Когда создаётся запись
При завершении заказа (`/api/orders/:id/complete` или `/api/orders/:id/partial-complete`) создаётся по одной записи на каждый ингредиент в рецепте блюда.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | Первичный ключ |
| `order_history_id` | UUID | ✅ | — | FK → slicer_order_history.id |
| `ingredient_id` | UUID | ❌ | — | FK → slicer_ingredients.id (SET NULL при удалении) |
| `ingredient_name` | VARCHAR(255) | ✅ | — | Название (сохраняем отдельно на случай удаления ингредиента) |
| `unit_type` | VARCHAR(10) | ✅ | — | `'kg'` или `'piece'` |
| `quantity` | NUMERIC(10,2) | ✅ | — | Количество (граммы или штуки × порции) |
| `weight_grams` | NUMERIC(10,2) | ✅ | — | Вес в граммах (всегда, для агрегации) |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания записи |

## Индексы

| Имя | Колонки | Назначение |
|---|---|---|
| `idx_slicer_consumption_ingredient` | `ingredient_id` | Агрегация по ингредиенту |
| `idx_slicer_consumption_order` | `order_history_id` | Связь с историей заказа |

## Foreign Keys

| FK | Ссылается на | ON DELETE | Назначение |
|---|---|---|---|
| `order_history_id` | `slicer_order_history(id)` | CASCADE | Удаление истории удаляет расход |
| `ingredient_id` | `slicer_ingredients(id)` | SET NULL | При удалении ингредиента сохраняем запись |

## Почему SET NULL для ingredient_id
Ингредиент может быть удалён из справочника, но историческая запись о расходе должна остаться для отчётности. Поле `ingredient_name` дублирует название для этого случая.

## Примеры SQL

### Записать расход при завершении заказа (транзакция):
```sql
-- Внутри транзакции complete:
INSERT INTO slicer_ingredient_consumption (order_history_id, ingredient_id, ingredient_name, unit_type, quantity, weight_grams)
VALUES
  ('uuid-истории', 'uuid-ингр-1', 'Картофель сырой', 'kg', 300.00, 300.00),
  ('uuid-истории', 'uuid-ингр-2', 'Курица', 'piece', 2.00, 600.00);
```

### Отчёт: общий расход ингредиентов за период:
```sql
SELECT c.ingredient_name, c.unit_type,
       SUM(c.quantity) AS total_quantity,
       SUM(c.weight_grams) AS total_weight_grams
FROM slicer_ingredient_consumption c
JOIN slicer_order_history h ON h.id = c.order_history_id
WHERE h.completed_at >= '2026-04-10' AND h.completed_at < '2026-04-11'
GROUP BY c.ingredient_name, c.unit_type
ORDER BY total_weight_grams DESC;
```

### Расход с группировкой по родительскому ингредиенту:
```sql
SELECT COALESCE(p.name, i.name) AS parent_name,
       c.ingredient_name AS variant_name,
       SUM(c.weight_grams) AS total_grams
FROM slicer_ingredient_consumption c
LEFT JOIN slicer_ingredients i ON i.id = c.ingredient_id
LEFT JOIN slicer_ingredients p ON p.id = i.parent_id
JOIN slicer_order_history h ON h.id = c.order_history_id
WHERE h.completed_at >= $1 AND h.completed_at <= $2
GROUP BY COALESCE(p.name, i.name), c.ingredient_name
ORDER BY parent_name, total_grams DESC;
```

## API эндпоинты
- `GET /api/dashboard/ingredient-usage?from=&to=` — агрегированный расход
