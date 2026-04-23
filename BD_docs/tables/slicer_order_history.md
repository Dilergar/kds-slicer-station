# slicer_order_history

## Назначение
История завершённых заказов нарезчика для KPI-отчётов. Содержит время приготовления, snapshot полного заказа (для UNDO/восстановления) и потреблённые ингредиенты (для отчёта расхода).

## Когда создаётся запись
- При полном завершении заказа (`POST /api/orders/:id/complete`)
- При частичном завершении (`POST /api/orders/:id/partial-complete`) — с пометкой "(Partial)" в dish_name

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | Первичный ключ |
| `dish_id` | VARCHAR(255) | ✅ | — | ID блюда (ctlg15_dishes.suuid) |
| `dish_name` | VARCHAR(255) | ✅ | — | Название блюда на момент завершения |
| `completed_at` | TIMESTAMPTZ | ✅ | `NOW()` | Время завершения |
| `total_quantity` | INT | ✅ | — | Количество порций |
| `prep_time_ms` | BIGINT | ✅ | — | Время приготовления в миллисекундах |
| `was_parked` | BOOLEAN | ❌ | `FALSE` | Был ли заказ паркован (для разделения KPI) |
| `snapshot` | JSONB | ❌ | `NULL` | Полный объект Order (для восстановления) |
| `consumed_ingredients` | JSONB | ❌ | `NULL` | Массив потреблённых ингредиентов |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания записи |

## Индексы

| Имя | Колонки | Назначение |
|---|---|---|
| `idx_slicer_order_history_time` | `completed_at` | Фильтрация по дате для Dashboard |
| `idx_slicer_order_history_parked` | `was_parked` | Разделение KPI: обычные vs паркованные |

## Формат JSONB полей

### snapshot (полный Order):
```json
{
  "id": "uuid",
  "dish_id": "uuid",
  "quantity_stack": [2],
  "table_stack": [[8, 5]],
  "created_at": 1746185992786,
  "status": "ACTIVE"
}
```

### consumed_ingredients:
```json
[
  {
    "id": "uuid-ингредиента",
    "name": "Картофель сырой",
    "imageUrl": "/images/potato.png",
    "unitType": "kg",
    "quantity": 300,
    "weightGrams": 300
  }
]
```

## TypeScript маппинг
```typescript
// types.ts → OrderHistoryEntry
interface OrderHistoryEntry {
  id: string;              // → id
  dishId: string;          // → dish_id
  dishName: string;        // → dish_name
  completedAt: number;     // → completed_at (TIMESTAMPTZ → Unix ms)
  totalQuantity: number;   // → total_quantity
  prepTimeMs: number;      // → prep_time_ms
  was_parked?: boolean;    // → was_parked
  snapshot: Order;         // → snapshot (JSONB)
  consumedIngredients: [...]; // → consumed_ingredients (JSONB)
}
```

## Примеры SQL

### Записать завершение заказа:
```sql
INSERT INTO slicer_order_history (dish_id, dish_name, total_quantity, prep_time_ms, was_parked, snapshot, consumed_ingredients)
VALUES (
  'uuid-блюда',
  '№51 Салат Тигр',
  2,
  185000,
  false,
  '{"id":"uuid","dish_id":"uuid","quantity_stack":[2],"table_stack":[[8,5]]}'::jsonb,
  '[{"id":"uuid","name":"Картофель","unitType":"kg","quantity":300,"weightGrams":300}]'::jsonb
)
RETURNING id;
```

### KPI: среднее время приготовления по блюдам:
```sql
SELECT dish_name, was_parked,
       COUNT(*) AS total_orders,
       SUM(total_quantity) AS total_portions,
       AVG(prep_time_ms) AS avg_prep_ms
FROM slicer_order_history
WHERE completed_at >= '2026-04-10' AND completed_at < '2026-04-11'
GROUP BY dish_name, was_parked
ORDER BY dish_name;
```

### Получить историю для Dashboard:
```sql
SELECT * FROM slicer_order_history
WHERE completed_at >= $1 AND completed_at <= $2
ORDER BY completed_at DESC;
```

## API эндпоинты
- `GET /api/history/orders?from=&to=` — получить историю
- `DELETE /api/history/orders/:id` — удалить (при restore)
- `GET /api/dashboard/speed-kpi?from=&to=` — агрегированные KPI
