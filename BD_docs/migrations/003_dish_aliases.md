# Миграция 003: Алиасы блюд

## Дата выполнения
2026-04-12

## Файл
`server/migrations/003_dish_aliases.sql`

## Что делает
Создаёт таблицу `slicer_dish_aliases` для решения проблемы "одно логическое блюдо — несколько вариантов" (например `163 Баклажаны` и `Д163 Баклажаны`).

### Созданная таблица
`slicer_dish_aliases (alias_dish_id, primary_dish_id, created_at)` — маппинг блюда-алиаса на блюдо-primary, у которого есть рецепт.

### Созданный индекс
`idx_slicer_dish_aliases_primary` на колонке `primary_dish_id` — для быстрого поиска всех алиасов конкретного primary.

## Зависимости
- Не зависит от схемы чужих таблиц (только "теневые" ссылки на `ctlg15_dishes.suuid` без FK)
- Должна быть выполнена после миграции 001 (базовые slicer_ таблицы)

## Как выполнить на продакшне
```bash
PGPASSWORD=<пароль> psql -U postgres -d arclient -f server/migrations/003_dish_aliases.sql
```

## Откат
```sql
DROP TABLE IF EXISTS slicer_dish_aliases;
```

## Влияние на существующие таблицы
**Никакого.** Таблица новая, с префиксом `slicer_`. Ничего в `ctlg15_dishes`, `docm2_*`, `slicer_recipes` не меняется.

## Влияние на API
- `/api/orders` — добавлен LEFT JOIN с `slicer_dish_aliases`, `dish_id` в ответе подменяется на `primary_dish_id` если есть алиас
- `/api/dishes` — добавлено поле `recipe_source_id` в ответ, ингредиенты резолвятся от primary
- Новый endpoint `/api/dish-aliases` (GET/POST/DELETE)

## Влияние на фронтенд
- `Dish.recipe_source_id` — новое опциональное поле
- `RecipeEditor.tsx` — добавлена секция "связанные варианты" и UI для управления алиасами
- `smartQueue.ts`, `SlicerStation.tsx`, `useOrders.ts` — **не меняются** (все алиасы резолвятся backend'ом)
