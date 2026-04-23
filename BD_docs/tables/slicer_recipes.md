# slicer_recipes

## Назначение
Связь блюдо → ингредиент с количеством на одну порцию. Это "рецепт" блюда для нарезчика: какие ингредиенты и сколько граммов/штук нужно нарезать на одну порцию.

## Почему отдельная таблица
В существующей БД есть `docm6_calculations` + `docm6tabl1_items` для калькуляций, но они **пустые** (0 записей). Модуль нарезчика ведёт свои рецепты.

## Метод связывания
`dish_id` содержит `suuid` из таблицы `ctlg15_dishes` (существующий справочник блюд KDS). Тип VARCHAR, а не UUID FK, потому что блюда принадлежат чужой таблице и мы не можем создать формальный Foreign Key.

`ingredient_id` — настоящий FK к `slicer_ingredients.id`.

## Резолв через алиасы (slicer_dish_aliases)
Рецепт хранится **только для primary-блюд**. Блюда-алиасы (записи в `slicer_dish_aliases`) используют рецепт своего primary через JOIN.

При загрузке блюда backend делает:
```sql
SELECT d.suuid, COALESCE(alias.primary_dish_id, d.suuid::text) AS recipe_source_id
FROM ctlg15_dishes d
LEFT JOIN slicer_dish_aliases alias ON alias.alias_dish_id = d.suuid::text
```

Затем ингредиенты подтягиваются по `recipe_source_id`, а не по самому `suuid` блюда. Для блюда-независимого `recipe_source_id === suuid`, для alias — `recipe_source_id === primary_dish_id`.

**Практический эффект:** пользователь прописывает рецепт один раз для блюда `163`, затем связывает с ним `Д163` через UI. Рецепт автоматически применяется к обоим при заказе. См. [slicer_dish_aliases.md](slicer_dish_aliases.md).

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | Первичный ключ |
| `dish_id` | VARCHAR(255) | ✅ | — | ID блюда (ctlg15_dishes.suuid) |
| `ingredient_id` | UUID | ✅ | — | FK → slicer_ingredients.id |
| `quantity_per_portion` | NUMERIC(10,2) | ✅ | — | Количество на порцию (граммы или штуки) |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата создания |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Дата последнего обновления |

## Constraints
- `UNIQUE(dish_id, ingredient_id)` — одно блюдо не может иметь один ингредиент дважды

## Индексы

| Имя | Колонки | Назначение |
|---|---|---|
| `idx_slicer_recipes_dish` | `dish_id` | Быстрый поиск рецепта по блюду |

## Foreign Keys

| FK | Ссылается на | ON DELETE | Назначение |
|---|---|---|---|
| `ingredient_id` | `slicer_ingredients(id)` | CASCADE | Удаление ингредиента удаляет его из рецептов |

## Связанные таблицы
- `ctlg15_dishes` (чтение) — получаем название блюда по `dish_id`
- `slicer_ingredients` — ингредиенты рецепта

## TypeScript маппинг
```typescript
// types.ts → DishIngredient (вложен в Dish.ingredients)
interface DishIngredient {
  id: string;      // → ingredient_id (UUID as string)
  quantity: number; // → quantity_per_portion
}

// При получении рецепта JOIN-ом добавляется:
// name, unitType, pieceWeightGrams, imageUrl из slicer_ingredients
```

## Примеры SQL

### Получить рецепт блюда:
```sql
SELECT r.ingredient_id, r.quantity_per_portion,
       i.name, i.unit_type, i.piece_weight_grams, i.image_url
FROM slicer_recipes r
JOIN slicer_ingredients i ON i.id = r.ingredient_id
WHERE r.dish_id = 'uuid-блюда'
ORDER BY i.name;
```

### Установить рецепт (полная замена):
```sql
-- 1. Удалить старые ингредиенты
DELETE FROM slicer_recipes WHERE dish_id = 'uuid-блюда';

-- 2. Вставить новые
INSERT INTO slicer_recipes (dish_id, ingredient_id, quantity_per_portion) VALUES
  ('uuid-блюда', 'uuid-ингредиента-1', 150.00),
  ('uuid-блюда', 'uuid-ингредиента-2', 50.00);
```

### Рассчитать общий вес порции (grams_per_portion):
```sql
SELECT dish_id, SUM(quantity_per_portion) AS grams_per_portion
FROM slicer_recipes
WHERE dish_id = 'uuid-блюда'
GROUP BY dish_id;
```

## API эндпоинты
- `GET /api/recipes/:dishId` — получить ингредиенты рецепта
- `PUT /api/recipes/:dishId` — установить/заменить рецепт (body: `{ingredients: [{ingredientId, quantity}]}`)
