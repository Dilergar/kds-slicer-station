# Миграция 012: target_name с префиксом code + alias-resolve в history

## Дата выполнения
2026-04-19

## Файл
`server/migrations/012_rgst3_archive_with_code.sql`

## Что делает
1. Переопределяет функцию триггера `slicer_archive_rgst3_delete()` — теперь `target_name` пишется как `<code> <name>` (например `"Д184 Дуфу острая"` вместо просто `"Дуфу острая"`).
2. UPDATE-ит существующие строки `slicer_stop_history` с `target_type='dish'` — добавляет префикс code, если его ещё нет.

## Зачем понадобилась

В `ctlg15_dishes` заказчика очень часто лежит один и тот же блюдо дважды —
раз для зала и раз для доставки. `name` у них идентичный, отличается только
`code` (например `184` и `Д184` — «Дуфу острая»). Проверено на реальных
данных: из 130 коллизий имён **107 (82%) — пары зал/доставка**.

Триггер миграции 011 писал только `name` в `target_name` → в истории
появлялись несколько записей с одинаковым именем. Dashboard группирует по
имени → слипал их в одну карточку → `totalDuration` раздувался двойным
учётом времени простоя. Для KPI нарезчика это критично — «простой 9 часов»
там где фактически было 4.5 часа.

## Как решено (двухслойный фикс)

**Слой 1 — триггер пишет с кодом.** Теперь в `slicer_stop_history`:
- `"184 Дуфу острая"` (зал)
- `"Д184 Дуфу острая"` (доставка)

Два разных имени → по умолчанию Dashboard их разделяет, каждое считается
отдельно. Это честное поведение для несвязанных блюд.

**Слой 2 — alias-resolve в `GET /api/stoplist/history`.** Если нарезчик
явно связал эти блюда через UI «Рецепты» → кнопка «Связать» (пишется в
`slicer_dish_aliases`), endpoint подставляет в ответе имя **primary** блюда
для обеих записей. В итоге в Dashboard они опять сливаются в одну карточку,
но теперь с правильным `totalDuration` благодаря `mergeIntervals` — union
перекрывающихся интервалов не даёт двойного учёта.

Таким образом:
- Без связи: две отдельные карточки, каждая со своим временем. Правда.
- Со связью: одна карточка с честным union. Правда.

## Что изменилось в коде

1. **`server/migrations/012_rgst3_archive_with_code.sql`** — сама миграция.
2. **`server/src/routes/stoplist.ts` GET /history**:
   - Загружается `aliasDisplayName: Map<string, string>` из `slicer_dish_aliases` + JOIN `ctlg15_dishes`.
   - При маппинге `sliceEntries` и `rgstEntries` для `target_type='dish'` применяется `resolveDishName(target_id, fallback)`.
   - SQL для rgst3-архива тоже собирает `target_name = <code> <name>` симметрично триггеру.
3. **Инструкция.md, CLAUDE.md, BD_docs** — обновлены.

## Примеры

```
-- В БД после миграции 012:
SELECT target_name FROM slicer_stop_history WHERE target_type='dish';
→ "Д184 Дуфу острая"
→ "184 Дуфу острая"
→ "Д91 Баранина с грибами"
→ ...

-- В ответе GET /api/stoplist/history без алиаса:
ingredientName: "[DISH] Д184 Дуфу острая"
ingredientName: "[DISH] 184 Дуфу острая"
→ Dashboard показывает 2 разных карточки.

-- После INSERT в slicer_dish_aliases (Д184 → 184):
ingredientName: "[DISH] 184 Дуфу острая"  (обе записи)
→ Dashboard показывает 1 карточку, mergeIntervals убирает дубли.
```

## Откат

```sql
-- Вернуть триггер к версии миграции 011 (target_name без code)
CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete() RETURNS trigger AS $$
-- ... (содержимое из миграции 011, см. 011_rgst3_archive_trigger.md)
$$ LANGUAGE plpgsql;

-- Убрать префикс code из существующих записей (опционально)
UPDATE slicer_stop_history h
   SET target_name = d.name
  FROM ctlg15_dishes d
 WHERE h.target_type = 'dish'
   AND d.suuid::text = h.target_id
   AND h.target_name = d.code || ' ' || d.name;
```

## Побочные эффекты

- Старые записи в `slicer_stop_history` до миграции 012 получили префикс
  code. 4 записи в локальной БД обновились автоматически.
- Размер `target_name` увеличился на 3-12 символов — помещается в
  `VARCHAR(255)` без проблем.
- Производительность: дополнительный `aliasesRes` в GET /history —
  один SELECT на запрос (aliasов мало, десятки), мгновенно.
