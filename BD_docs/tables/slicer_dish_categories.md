# slicer_dish_categories

**Назначение**: хранит ручное назначение slicer-категорий (категорий нарезчика) блюдам из чужой таблицы `ctlg15_dishes`. Нарезчик сам назначает блюду категорию через UI «Рецепты» (модалка редактирования блюда). Одно блюдо может быть одновременно в нескольких категориях (до 3, согласно ограничению UI).

Без этой таблицы все блюда возвращаются из `GET /api/dishes` с пустым `category_ids` и попадают в секцию «Без категории» в [RecipeEditor.tsx](../../components/admin/RecipeEditor.tsx).

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `dish_id` | `VARCHAR(255)` | ✓ | — | Ссылка на `ctlg15_dishes.suuid` (строка, не FK — чужую таблицу не трогаем) |
| `category_id` | `UUID` | ✓ | — | FK на `slicer_categories.id`, `ON DELETE CASCADE` |
| `assigned_at` | `TIMESTAMPTZ` | ✓ | `NOW()` | Время последнего назначения |

## Ключи и индексы

- **PRIMARY KEY**: `(dish_id, category_id)` — запрещает дубликаты
- **INDEX**: `idx_slicer_dish_categories_dish` на `dish_id` — быстрый поиск категорий по блюду при сборке ответа в `GET /api/dishes`
- **FK**: `category_id → slicer_categories(id) ON DELETE CASCADE` — удаление категории автоматически убирает назначения

## Связи

- `dish_id` → `ctlg15_dishes.suuid` (теневая связь, без формального FK — правило CLAUDE.md)
- `category_id` → `slicer_categories.id` (формальный FK)

## Как используется

**Чтение**: [server/src/routes/dishes.ts](../../server/src/routes/dishes.ts) в `GET /api/dishes` делает `SELECT dish_id, array_agg(category_id) FROM slicer_dish_categories GROUP BY dish_id` и подставляет результат в поле `category_ids` ответа.

**Запись**: [server/src/routes/dishes.ts](../../server/src/routes/dishes.ts) в `PUT /api/dishes/:dishId/categories` делает полную замену (DELETE + INSERT в транзакции). Фронтенд вызывает это из `RecipeEditor.saveDishForm` при сохранении рецепта.

## Примеры

Назначить блюду категории:
```sql
INSERT INTO slicer_dish_categories (dish_id, category_id) VALUES
  ('<ctlg15_dishes.suuid>', '<slicer_categories.id>'),
  ('<ctlg15_dishes.suuid>', '<slicer_categories.id>')
ON CONFLICT DO NOTHING;
```

Получить категории блюда:
```sql
SELECT c.name
FROM slicer_dish_categories dc
JOIN slicer_categories c ON c.id = dc.category_id
WHERE dc.dish_id = '<ctlg15_dishes.suuid>';
```
