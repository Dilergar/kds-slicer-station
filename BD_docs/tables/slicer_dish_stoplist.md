# slicer_dish_stoplist — Актуальный стоп-лист блюд модуля

## Назначение
Хранит **текущее состояние стоп-листа блюд** модуля нарезчика. До появления
этой таблицы состояние стопа блюд жило только во фронтенд-React-state и
терялось при F5, а каскадная логика (блюдо остановлено автоматически из-за
стопнутого ингредиента) выполнялась на фронтенде и не попадала в историю.

Теперь источник правды — эта таблица. В ней одна строка = одно остановленное
блюдо. Различает два типа стопа:

- **`MANUAL`** — поставлен пользователем через UI (кнопка «Стоп» на карточке блюда)
- **`CASCADE`** — автоматически рассчитан `recalculateCascadeStops()` в ответ
  на стоп ингредиента из рецепта блюда. При возврате ингредиента такие строки
  удаляются автоматически.

**Ручной стоп всегда побеждает каскадный** — если блюдо остановлено вручную,
функция пересчёта каскада не перезаписывает его через `ON CONFLICT DO NOTHING`.
Когда ингредиент возвращается, ручной стоп остаётся.

## Колонки

| Колонка | Тип | NOT NULL | Default | Описание |
|---|---|---|---|---|
| `dish_id` | VARCHAR | ✅ | — | PK. Теневая ссылка на `ctlg15_dishes.suuid` (без FK — чужая таблица). |
| `stop_type` | VARCHAR | ✅ | — | `'MANUAL'` или `'CASCADE'`. Ограничено CHECK. |
| `reason` | TEXT | — | NULL | Причина стопа. Для CASCADE — `'Missing: <ingredient_name>'`. Для MANUAL — произвольный текст от пользователя. |
| `stopped_at` | TIMESTAMPTZ | ✅ | `NOW()` | Время начала стопа. Используется для расчёта `duration_ms` при записи в `slicer_stop_history`. |
| `cascade_ingredient_id` | UUID | — | NULL | Только для `CASCADE`: какой ингредиент заблокировал блюдо. FK → `slicer_ingredients(id) ON DELETE CASCADE`. |
| `rgst3_row_suuid` | UUID | — | NULL | Ссылка на `rgst3_dishstoplist.suuid` для двусторонней синхронизации (миграция 006). NULL для MANUAL/CASCADE не зеркалящихся в чужую KDS. |
| `stopped_by_uuid` | UUID | — | NULL | UUID актора поставившего стоп (миграция 014). Переносится в `slicer_stop_history.stopped_by_uuid` при снятии. |
| `stopped_by_name` | VARCHAR | — | NULL | Имя/логин актора поставившего стоп (миграция 014). |
| `actor_source` | VARCHAR | — | NULL | Источник: `'slicer'`, `'kds'`, `'cascade'` (миграция 014). |

## Индексы

- `slicer_dish_stoplist_pkey` — PK по `dish_id` (автоматически)
- `idx_slicer_dish_stoplist_cascade_ing` — partial по `cascade_ingredient_id`
  для `stop_type = 'CASCADE'`, используется при массовом удалении каскадных
  строк когда ингредиент возвращается.
- `idx_slicer_dish_stoplist_type` — по `stop_type`, используется для UNION с
  `rgst3_dishstoplist` в `GET /api/dishes`.

## Foreign Keys

- `cascade_ingredient_id → slicer_ingredients(id) ON DELETE CASCADE` — если
  ингредиент удаляют из справочника, каскадные стопы подчищаются автоматически.

## Связанные таблицы

| Таблица | Связь |
|---|---|
| `slicer_ingredients` | FK `cascade_ingredient_id` (только для CASCADE) |
| `slicer_recipes` | Источник целевого набора каскадных стопов (не FK) |
| `slicer_dish_aliases` | Каскад распространяется с primary на все алиасы блюда |
| `rgst3_dishstoplist` | UNION в `GET /api/dishes` — стоп из основной KDS плюс наш |
| `slicer_stop_history` | Куда записывается завершённый стоп при DELETE строки |

## Логика `recalculateCascadeStops`

Вызывается в той же транзакции что и любой `POST /api/stoplist/toggle` для
ингредиента (или `toggle` блюда при снятии ручного стопа).

Алгоритм:

1. **Целевой набор** — SQL-запрос с CTE вычисляет блюда которые ДОЛЖНЫ быть
   на каскадном стопе:
   - Берутся ингредиенты с `is_stopped = true`
   - Плюс дети parent-ингредиентов с `is_stopped = true`
   - JOIN с `slicer_recipes` → получаем блюда (primary dish_ids)
   - UNION с `slicer_dish_aliases.alias_dish_id` где `primary_dish_id` в наборе

2. **Текущие CASCADE-строки** читаются из `slicer_dish_stoplist WHERE stop_type='CASCADE'`.

3. **Diff:**
   - `toRemove` (было каскадное, теперь не должно быть) → INSERT
     `slicer_stop_history` с `duration_ms = NOW() - stopped_at` + DELETE строки
   - `toAdd` (должно быть каскадным, строки нет) → INSERT с `ON CONFLICT DO NOTHING`

4. MANUAL-строки игнорируются полностью.

## Примеры запросов

### Поставить ручной стоп
```sql
INSERT INTO slicer_dish_stoplist (dish_id, stop_type, reason, stopped_at, cascade_ingredient_id)
VALUES ('45568b66-1c8f-4906-9ff0-4444d7437004', 'MANUAL', 'Нет воды', NOW(), NULL)
ON CONFLICT (dish_id) DO UPDATE SET
  stop_type = 'MANUAL',
  reason = EXCLUDED.reason,
  cascade_ingredient_id = NULL;
```

### Снять стоп с записью в историю
```sql
-- 1. Прочитать строку
SELECT stop_type, reason, stopped_at FROM slicer_dish_stoplist WHERE dish_id = $1;
-- 2. Записать в историю
INSERT INTO slicer_stop_history (target_type, target_id, target_name, stopped_at, resumed_at, reason, duration_ms)
VALUES ('dish', $1, $dish_name, $stopped_at, NOW(), $reason, EXTRACT(EPOCH FROM NOW() - $stopped_at) * 1000);
-- 3. Удалить
DELETE FROM slicer_dish_stoplist WHERE dish_id = $1;
```

### Получить все остановленные блюда (UNION с KDS)
```sql
SELECT rgst3_ctlg15_uuid__dish::text AS dish_uuid, NULL::text AS reason
FROM rgst3_dishstoplist
UNION ALL
SELECT dish_id AS dish_uuid, reason
FROM slicer_dish_stoplist;
```

## Кто пишет в таблицу

- `server/src/routes/stoplist.ts`:
  - `POST /api/stoplist/toggle` для `targetType='ingredient'` → `recalculateCascadeStops` (только CASCADE)
  - `POST /api/stoplist/toggle` для `targetType='dish'` → UPSERT/DELETE MANUAL
- `recalculateCascadeStops()` (helper в том же файле) — вызывается при любом
  изменении стопа ингредиента и при снятии ручного стопа (чтобы восстановить
  каскадную запись если ингредиент всё ещё стопнут).
