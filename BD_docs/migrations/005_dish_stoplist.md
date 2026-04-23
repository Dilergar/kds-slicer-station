# Миграция 005: slicer_dish_stoplist

## Дата выполнения
2026-04-15

## Файл
`server/migrations/005_dish_stoplist.sql`

## Что делает
Создаёт одну новую таблицу `slicer_dish_stoplist` и два индекса.

Таблица хранит **актуальное состояние стоп-листа блюд** модуля нарезчика
(до этой миграции оно жило только во фронтенд-React-state и терялось при F5).

## Зачем понадобилась

До миграции был баг #2 из code review:

1. Ручной стоп блюда → только React state. F5 сбрасывал стоп.
2. Каскадный стоп (блюдо остановлено потому что его ингредиент на стопе) →
   жил в `useEffect` во фронтенде. При F5 не попадал в `slicer_stop_history`,
   Dashboard врал по % downtime. При работе на нескольких устройствах каскад
   не синхронизировался.

После миграции оба типа стопов персистятся, каскад вычисляется на backend в
одной транзакции с toggle ингредиента.

## Колонки

| Колонка | Тип | NOT NULL | Default | Описание |
|---|---|---|---|---|
| `dish_id` | VARCHAR | ✅ | — | PK. Теневая ссылка на `ctlg15_dishes.suuid`. |
| `stop_type` | VARCHAR | ✅ | — | `'MANUAL'` или `'CASCADE'` (CHECK constraint). |
| `reason` | TEXT | — | NULL | Текст причины. Для CASCADE: `'Missing: <ingredient>'`. |
| `stopped_at` | TIMESTAMPTZ | ✅ | `NOW()` | Начало стопа для расчёта `duration_ms`. |
| `cascade_ingredient_id` | UUID | — | NULL | FK → `slicer_ingredients(id) ON DELETE CASCADE`. Только для CASCADE. |

## Индексы

- `slicer_dish_stoplist_pkey` — PK по `dish_id`
- `idx_slicer_dish_stoplist_cascade_ing` — partial по `cascade_ingredient_id`
  WHERE `stop_type = 'CASCADE'`
- `idx_slicer_dish_stoplist_type` — по `stop_type`

## Зависимости
- Таблица `slicer_ingredients` должна существовать (миграция 001) —
  требуется для FK `cascade_ingredient_id`
- Таблицы `slicer_recipes`, `slicer_dish_aliases` используются логикой
  `recalculateCascadeStops()` на чтение (миграции 001, 003)

## Как выполнить
```bash
PGPASSWORD=<пароль> psql -U postgres -d arclient -v ON_ERROR_STOP=1 \
  -f server/migrations/005_dish_stoplist.sql
```

Или через `npm run migrate` в `server/` — скрипт прогонит все 5 миграций
по порядку.

## Откат (если понадобится)
```sql
DROP TABLE IF EXISTS slicer_dish_stoplist;
```
Каскад на `slicer_stop_history` не нужен — эта таблица независима.

## Связанная backend-логика
- `server/src/routes/stoplist.ts` — функция `recalculateCascadeStops()` и
  обработчики `POST /api/stoplist/toggle`
- `server/src/routes/dishes.ts` — UNION этой таблицы с `rgst3_dishstoplist`
  в `GET /api/dishes`
