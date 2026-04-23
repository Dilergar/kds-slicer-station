# Алиасы блюд (Dish Aliases)

## Задача
В БД `arclient` одно логическое блюдо существует в нескольких вариантах с разными `code` в `ctlg15_dishes`:
- `163 Баклажаны в горшочке` — зал
- `Д163 Баклажаны в горшочке` — доставка (префикс Д)

Для нарезчика это одно блюдо — режет одинаково. Нужен один рецепт на оба варианта + агрегация в очереди KDS.

## Модель данных
```sql
CREATE TABLE slicer_dish_aliases (
  alias_dish_id VARCHAR(255) PRIMARY KEY,  -- suuid блюда-алиаса
  primary_dish_id VARCHAR(255) NOT NULL,    -- suuid блюда с рецептом
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
`alias_dish_id` = PK → одно блюдо может быть алиасом только одного primary (одно блюдо = один рецепт).
Обе колонки — "теневые" ссылки на `ctlg15_dishes.suuid` без FK (правило не трогать чужие таблицы).

## Ключевое архитектурное решение: резолв на backend
**Фронтенд НЕ знает об алиасах.** Вся магия внутри backend:

### `GET /api/orders` — подмена dish_id
`COALESCE(alias.primary_dish_id::uuid, items.docm2tabl1_ctlg15_uuid__dish) AS dish_id` — два заказа (`163` и `Д163`) в ответе имеют одинаковый `dish_id = UUID-163`. `smartQueue.ts` агрегирует их как одно блюдо.

### `GET /api/dishes` — resolve recipe_source_id
`COALESCE(alias.primary_dish_id, d.suuid::text) AS recipe_source_id`. Ингредиенты из `slicer_recipes` подтягиваются по `recipe_source_id`, а не по `d.suuid`. Для алиасов это даёт рецепт primary.

## Автокопия категорий при связывании
`POST /api/dish-aliases` в одной транзакции:
1. UPSERT в `slicer_dish_aliases`
2. `DELETE FROM slicer_dish_categories WHERE dish_id = alias` (убираем старые назначения)
3. `INSERT ... SELECT FROM slicer_dish_categories WHERE dish_id = primary` (копируем от primary)

Без этого alias-блюдо оставалось бы в секции «Без категории» и ломало бы сортировку очереди. Теперь сразу после связывания alias попадает в те же волны, что и primary.

## Группировка test-заказов по каноническому id
`/api/orders` резолвит dish_id через COALESCE, но тест-заказы добавляются в `useOrders.handleAddTestOrder` локально с оригинальным `alias_dish_id`. Чтобы агрегация работала и для них, `flattenOrders` в `smartQueue.ts` использует `canonicalDishId = rawDish.recipe_source_id || rawDish.id` как ключ группировки и источник имени/категории. Для реальных `/api/orders` это no-op.

## Что НЕ меняется (важно!)
- `slicer_recipes` — схема та же (рецепты только для primary блюд)
- `SlicerStation.tsx`, `useOrders.ts` — ни единой строчки
- Типы `FlatOrderItem`, `SmartQueueGroup`, `Order` — без изменений
- `smartQueue.ts` — теперь учитывает `recipe_source_id` (см. выше), это единственная правка ради тест-заказов

## Файлы изменений
- `server/migrations/003_dish_aliases.sql` — создана таблица
- `server/src/routes/orders.ts` — JOIN + COALESCE подмена
- `server/src/routes/dishes.ts` — JOIN + recipe_source_id
- `server/src/routes/dishAliases.ts` — GET/POST/DELETE endpoints
- `server/src/index.ts` — зарегистрирован роутер
- `types.ts` — добавлено `Dish.recipe_source_id`
- `services/dishAliasesApi.ts` — создан API-клиент
- `components/admin/RecipeEditor.tsx` — UI алиасов (кнопка Link2, модалка, секция "связанные варианты", фильтр "скрыть алиасы")
- `components/AdminPanel.tsx` — прокинут `onRefreshDishes`
- `App.tsx` — добавлен `reloadDishes` callback

## UI в RecipeEditor
- Чекбокс "Показать связанные варианты" — по умолчанию alias-блюда скрыты из списка
- Кнопка Link2 на карточке каждого блюда → открывает модалку выбора блюд для связи
- Секция "Связанные варианты" под карточкой primary — показывает все его алиасы
- Индикатор "Алиас → использует рецепт primary-блюда" + кнопка "Отвязать" на alias-блюде

## Проверка end-to-end (прошла)
1. Миграция создала таблицу
2. `POST /api/dish-aliases` создал тестовый алиас Д163 → 163
3. `/api/dishes` для Д163 вернул `recipe_source_id = UUID-163`
4. `/api/orders` не содержит UUID Д163 — подменён на UUID-163
5. `typecheck` чист
6. `DELETE /api/dish-aliases/:id` удалил тестовый алиас

## API эндпоинты
- `GET /api/dish-aliases` — список всех
- `POST /api/dish-aliases` — `{alias_dish_id, primary_dish_id}`, UPSERT
- `DELETE /api/dish-aliases/:alias_dish_id` — удалить

## Документация
- `BD_docs/tables/slicer_dish_aliases.md`
- `BD_docs/migrations/003_dish_aliases.md`
- `BD_docs/tables/slicer_recipes.md` — секция "Резолв через алиасы"
- `BD_docs/mappings.md`
- `CLAUDE.md` — паттерн 5 "Алиасы блюд"
