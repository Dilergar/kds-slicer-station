# slicer_ingredients

## Назначение
Справочник ингредиентов модуля нарезчика с двухуровневой иерархией (Родитель → Разновидность). Хранит также состояние стоп-листа: если ингредиент остановлен, все блюда с ним автоматически блокируются.

## Почему отдельная таблица
В существующей БД есть `ctlg25_nomenclature`, но она **пустая** (0 записей). Модулю нарезчика нужна собственная номенклатура с иерархией, единицами измерения и стоп-листом.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | Первичный ключ |
| `name` | VARCHAR(255) | ✅ | — | Название (например, "Картофель сырой") |
| `parent_id` | UUID | ❌ | `NULL` | FK → slicer_ingredients.id (родительский ингредиент) |
| `image_url` | TEXT | ❌ | `NULL` | Относительный путь: `/images/ingredients/<id>.<ext>`. Файл лежит на диске в `server/public/images/ingredients/`. До миграции 009 здесь хранился Base64 (очищен). |
| `image_content_type` | VARCHAR(50) | ❌ | `NULL` | MIME-тип (диагностика), добавлен миграцией 009 |
| `image_file_size` | INT | ❌ | `NULL` | Размер файла в байтах (мониторинг), миграция 009 |
| `unit_type` | VARCHAR(10) | ✅ | `'kg'` | Единица: `'kg'` (граммы) или `'piece'` (штуки) |
| `piece_weight_grams` | NUMERIC(10,2) | ❌ | `NULL` | Вес одной штуки в граммах (только для unit_type='piece') |
| `buffer_percent` | NUMERIC(5,2) | ✅ | `0` | Надбавка в % для расчёта брутто в Dashboard (миграция 010) |
| `is_stopped` | BOOLEAN | ✅ | `FALSE` | На стоп-листе? |
| `stop_reason` | VARCHAR(255) | ❌ | `NULL` | Причина стопа ("Out of Stock", "Spoilage" и т.д.) |
| `stop_timestamp` | TIMESTAMPTZ | ❌ | `NULL` | Когда поставлен на стоп |
| `stopped_by_uuid` | UUID | ❌ | `NULL` | UUID актора поставившего стоп (миграция 014). Переносится в `slicer_stop_history.stopped_by_uuid` при снятии |
| `stopped_by_name` | VARCHAR(255) | ❌ | `NULL` | Имя/логин актора поставившего стоп (миграция 014) |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата последнего обновления |

## Индексы

| Имя | Колонки | Тип | Назначение |
|---|---|---|---|
| `idx_slicer_ingredients_parent` | `parent_id` | B-tree | Быстрый поиск детей по родителю |
| `idx_slicer_ingredients_stopped` | `is_stopped` | Partial (WHERE is_stopped = TRUE) | Быстрый поиск остановленных ингредиентов |

## Foreign Keys

| FK | Ссылается на | ON DELETE | Назначение |
|---|---|---|---|
| `parent_id` | `slicer_ingredients(id)` | CASCADE | Удаление родителя каскадно удаляет детей |

## Иерархия parent → child

```
Родитель (parent_id = NULL):
  id: "abc-123", name: "Картофель"
    └── Ребёнок (parent_id = "abc-123"):
        id: "def-456", name: "Картофель сырой"
    └── Ребёнок (parent_id = "abc-123"):
        id: "ghi-789", name: "Пюре картофельное"
```

**Каскад стоп-листа:** Если родитель `is_stopped = true`, все дети считаются остановленными (логика на backend/frontend).

## TypeScript маппинг
```typescript
// types.ts → IngredientBase
interface IngredientBase {
  id: string;               // → id (UUID as string)
  name: string;             // → name
  parentId?: string;        // → parent_id
  imageUrl?: string;        // → image_url
  unitType?: 'kg' | 'piece'; // → unit_type
  pieceWeightGrams?: number; // → piece_weight_grams
  is_stopped: boolean;      // → is_stopped
  stop_reason?: string;     // → stop_reason
  stop_timestamp?: number;  // → stop_timestamp (TIMESTAMPTZ → Unix ms)
}
```

## Примеры SQL

### Получить все ингредиенты с иерархией:
```sql
SELECT id, name, parent_id, image_url, unit_type, piece_weight_grams,
       is_stopped, stop_reason, stop_timestamp
FROM slicer_ingredients
ORDER BY parent_id NULLS FIRST, name;
```

### Создать родительский ингредиент:
```sql
INSERT INTO slicer_ingredients (name, unit_type)
VALUES ('Перец полугорький', 'kg')
RETURNING id;
```

### Создать дочерний ингредиент:
```sql
INSERT INTO slicer_ingredients (name, parent_id, unit_type)
VALUES ('Перец СОЛОМКА', 'uuid-родителя', 'kg')
RETURNING id;
```
Картинку добавляйте отдельным запросом `POST /api/ingredients/:id/image`
(multipart/form-data, поле `image`) — не через SQL. Multer сам запишет
путь в `image_url`.

### Поставить на стоп:
```sql
UPDATE slicer_ingredients
SET is_stopped = true, stop_reason = 'Out of Stock', stop_timestamp = NOW(), updated_at = NOW()
WHERE id = 'uuid-ингредиента';
```

### Снять со стопа:
```sql
UPDATE slicer_ingredients
SET is_stopped = false, stop_reason = NULL, stop_timestamp = NULL, updated_at = NOW()
WHERE id = 'uuid-ингредиента';
```

### Найти все остановленные ингредиенты (включая каскад через родителя):
```sql
SELECT i.id, i.name, i.is_stopped, p.name AS parent_name, p.is_stopped AS parent_stopped
FROM slicer_ingredients i
LEFT JOIN slicer_ingredients p ON p.id = i.parent_id
WHERE i.is_stopped = true OR p.is_stopped = true;
```

## API эндпоинты
- `GET /api/ingredients` — список всех
- `POST /api/ingredients` — создать
- `PUT /api/ingredients/:id` — обновить
- `DELETE /api/ingredients/:id` — удалить (каскадно удаляет детей)
- `POST /api/stoplist/toggle` — переключить стоп-лист (body: `{targetId, targetType: 'ingredient', reason}`)
