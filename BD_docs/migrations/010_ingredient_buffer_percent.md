# Миграция 010: slicer_ingredients.buffer_percent

## Дата выполнения
2026-04-19

## Файл
`server/migrations/010_ingredient_buffer_percent.sql`

## Что делает
Добавляет колонку `buffer_percent NUMERIC(5, 2) NOT NULL DEFAULT 0` в
`slicer_ingredients` + `COMMENT ON COLUMN`.

## Зачем понадобилась

В Dashboard → «Расход Ингредиентов» есть колонка «+ %» — надбавка на
потери/чистку для расчёта брутто. До миграции 010 значение жило в
локальном `useState` компонента `IngredientUsageSection` — при F5
сбрасывалось в 0 и пересчёт брутто улетал.

## Что изменилось в коде

1. **`server/migrations/010_ingredient_buffer_percent.sql`** — сама миграция.
2. **`server/src/routes/ingredients.ts`** — `GET /api/ingredients` возвращает `bufferPercent`, `PUT /api/ingredients/:id` принимает его в body (через существующий PATCH-fieldmap). `RETURNING` расширен на колонку.
3. **`types.ts`** — `IngredientBase.bufferPercent?: number`.
4. **`App.tsx`** — прокинут `handleUpdateIngredient` в `<Dashboard>`.
5. **`components/Dashboard.tsx`** — прокинут `onUpdateIngredient` в `<IngredientUsageSection>`.
6. **`components/dashboard/IngredientUsageSection.tsx`** — `useEffect` инициализирует `bufferPercentages` из `ingredients[].bufferPercent`; новый `handleBufferBlur(id)` сохраняет в БД при blur, если значение изменилось.

## Колонка

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `buffer_percent` | NUMERIC(5,2) | ✅ | `0` | Надбавка в % для брутто в отчёте «Расход Ингредиентов» |

`NUMERIC(5, 2)` покрывает значения от 0.00 до 999.99 — избыточно, но оставляем запас (на случай нестандартных значений типа 150% для ягод).

## Решение: на blur, не на onChange

При каждом onChange (набрал «15») было бы 3 PUT — перебор и дёргает БД.
Сохраняем на `onBlur` (пользователь перешёл к следующему полю). В коде
проверяем: если `nextValue === currentValue` — PUT не шлём вовсе.

## Откат

```sql
ALTER TABLE slicer_ingredients DROP COLUMN IF EXISTS buffer_percent;
```

Потеря данных: все заданные проценты обнулятся, UI начнёт с 0 как до 010.
