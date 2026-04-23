# slicer_dish_priority

## Назначение
Хранит приоритет отображения блюда на доске нарезчика: NORMAL (1, обычный)
или ULTRA (3, всегда наверху очереди). Значение соответствует enum
`PriorityLevel` в `types.ts`.

Отсутствие записи = NORMAL (дефолт применяется в `GET /api/dishes` через
`Map.get(id) ?? 1`). Благодаря этому подавляющее большинство блюд не
занимает места в таблице — строки появляются только для ULTRA-блюд или
при явном сохранении NORMAL через RecipeEditor.

Отдельная таблица, а не колонка в `slicer_dish_categories` — потому что
приоритет это свойство **блюда**, а не связки блюдо↔категория. Хранить
его в M2M-таблице означало бы дублировать значение по числу категорий и
поддерживать консистентность вручную.

## Метод связывания
`dish_id` содержит `ctlg15_dishes.suuid` — чужая таблица, **не FK**, а
текстовая ссылка (теневой подход, как и в остальных `slicer_*`-таблицах).

При алиасах запись пишется на конкретный `dish_id` (не на primary) —
в RecipeEditor primary и alias показаны отдельными карточками и могут
иметь разные приоритеты.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `dish_id` | TEXT | ✅ | — | **PK**. UUID блюда из `ctlg15_dishes.suuid` |
| `priority_flag` | INTEGER | ✅ | `1` | 1 = NORMAL, 3 = ULTRA. CHECK ограничивает допустимые значения |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Когда последний раз обновили |

## Ограничения
- `CHECK (priority_flag IN (1, 3))` — защита от невалидных значений на уровне БД.
- Backend `PUT /api/dishes/:dishId/priority` дополнительно валидирует body,
  возвращая 400 до попадания в INSERT.

## Индексы
Нет индексов помимо PK — выборка идёт всегда по `dish_id` (UNIQUE PK).

## Жизненный цикл

1. **Save из RecipeEditor.** `PUT /api/dishes/:dishId/priority` с body
   `{priority_flag: 1|3}`. UPSERT: `INSERT ... ON CONFLICT (dish_id) DO UPDATE`.
2. **Чтение.** `GET /api/dishes` загружает все строки таблицы в Map и
   для каждого блюда выдаёт `priorityByDish.get(id) ?? 1`.
3. **Reset slicer-data.** `DELETE /api/dishes/:dishId/slicer-data` удаляет
   запись — после сброса блюдо возвращается к дефолту NORMAL.

## Пример запросов

```sql
-- Все ULTRA-блюда
SELECT dish_id FROM slicer_dish_priority WHERE priority_flag = 3;

-- Сколько блюд явно выставлено в NORMAL (обычно они не пишутся, но могут появиться)
SELECT COUNT(*) FROM slicer_dish_priority WHERE priority_flag = 1;

-- Вручную поставить блюду ULTRA
INSERT INTO slicer_dish_priority (dish_id, priority_flag)
VALUES ('<uuid>', 3)
ON CONFLICT (dish_id) DO UPDATE SET priority_flag = 3, updated_at = NOW();
```
