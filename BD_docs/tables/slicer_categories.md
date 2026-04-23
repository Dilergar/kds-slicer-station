# slicer_categories

## Назначение
Категории блюд с порядком сортировки для KDS-доски нарезчика. Определяют приоритет вывода в режиме COURSE_FIFO: блюда из категории с меньшим `sort_index` выводятся первыми.

## Почему отдельная таблица
В существующей БД есть `ctlg38_goodcategories`, но она **пустая** (0 записей). Модуль нарезчика использует свои категории с собственным порядком сортировки.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | Первичный ключ |
| `name` | VARCHAR(255) | ✅ | — | Название категории (например, "VIP", "Супы") |
| `sort_index` | INT | ✅ | `0` | Индекс сортировки: 0 = наивысший приоритет |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата последнего обновления |

## Индексы
Нет дополнительных индексов (таблица маленькая, сканируется полностью).

## Foreign Keys
Нет.

## Связанные таблицы
- Используется фронтендом для сортировки заказов (COURSE_FIFO алгоритм в `smartQueue.ts`)
- Привязка к блюдам через `ctlg15_dishes.ctlg15_ctlg38_uuid__goodcategory` → маппинг на стороне backend

## TypeScript маппинг
```typescript
// types.ts → Category
interface Category {
  id: string;        // → slicer_categories.id
  name: string;      // → slicer_categories.name
  sort_index: number; // → slicer_categories.sort_index
}
```

## Примеры SQL

### Получить все категории:
```sql
SELECT id, name, sort_index
FROM slicer_categories
ORDER BY sort_index ASC;
```

### Создать категорию:
```sql
INSERT INTO slicer_categories (name, sort_index)
VALUES ('Горячее', 3)
RETURNING id, name, sort_index;
```

### Переместить категорию вверх (swap sort_index):
```sql
-- Поменять местами "Супы" (index=1) и "Салаты" (index=2)
UPDATE slicer_categories SET sort_index = 2 WHERE name = 'Супы';
UPDATE slicer_categories SET sort_index = 1 WHERE name = 'Салаты';
```

## Начальные данные (seed)
```sql
INSERT INTO slicer_categories (name, sort_index) VALUES
  ('VIP', 0),
  ('Супы', 1),
  ('Салаты', 2),
  ('Горячее', 3),
  ('Десерты', 4);
```

## API эндпоинты
- `GET /api/categories` — список всех
- `POST /api/categories` — создать
- `PUT /api/categories/:id` — обновить
- `DELETE /api/categories/:id` — удалить
- `PUT /api/categories/reorder` — пакетная смена порядка
