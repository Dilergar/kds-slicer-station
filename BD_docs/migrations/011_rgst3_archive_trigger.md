# Миграция 011: BEFORE DELETE триггер на rgst3_dishstoplist

## Дата выполнения
2026-04-19

## Файл
`server/migrations/011_rgst3_archive_trigger.sql`

## Что делает
1. Создаёт функцию `slicer_archive_rgst3_delete()` (PL/pgSQL) — копирует OLD row из `rgst3_dishstoplist` в `slicer_stop_history` при каждом DELETE.
2. Создаёт триггер `slicer_archive_rgst3_delete_trg` BEFORE DELETE ON `rgst3_dishstoplist` FOR EACH ROW.
3. Добавляет `COMMENT` на функцию и триггер.

## Зачем понадобилась

`rgst3_dishstoplist` — таблица стоп-листа основной KDS. Кассир ставит
стоп (INSERT) и снимает стоп (DELETE). При снятии row исчезает
безвозвратно — поля для snapshots (resumed_at, closed_flag) там нет.

Без триггера наш модуль видит только **активные** стопы (живые строки
в открытой смене через UNION в `GET /api/dishes`). Но для отчётов в
Dashboard нужны **завершённые** стопы с полным интервалом
`[stopped_at; resumed_at]` — их нужно было где-то хранить.

Сценарий ресторана: «9:00 — кассир ставит блюдо на стоп (нет ингредиента),
14:00 — привезли, кассир снимает стоп». Без триггера эта запись пропадёт
без следа. С триггером — остаётся в `slicer_stop_history` навсегда.

## Что изменилось в коде

1. **`server/migrations/011_rgst3_archive_trigger.sql`** — сама миграция.
2. **`server/src/routes/stoplist.ts` GET /history** — UNION двух источников:
   - `slicer_stop_history` (наша таблица: свои стопы + захваченные триггером).
   - `rgst3_dishstoplist` из закрытых смен (стопы дожившие до конца смены — триггер на них не срабатывает, DELETE не было).
3. **`CLAUDE.md`, `Инструкция.md`** — документируют новое исключение в правиле неприкосновенности.

## Ключевые решения

### Защита от дубликатов с двусторонней синхронизацией (раздел 10)

Если включить двустороннюю синхронизацию, модуль сам делает DELETE в
rgst3 при снятии стопа. Триггер тоже сработает — получится дубликат
(наш код уже записал в slicer_stop_history через `/api/stoplist/toggle`).

Защита: триггер смотрит на `OLD.inserter` и сравнивает с
`slicer_kds_sync_config.inserter_text`. Если совпадает — пропускает
запись. Наши DELETE не архивируются повторно, чужие (кассир) — пишутся.

### Fallback на имя блюда

`SELECT name INTO v_dish_name FROM ctlg15_dishes WHERE suuid = OLD.rgst3_ctlg15_uuid__dish`.
Если блюдо в справочнике отсутствует (редкий edge case) — пишем
`'Unknown dish'` вместо NULL (колонка NOT NULL).

### Duration

`GREATEST(0, EXTRACT(EPOCH FROM NOW() - OLD.insert_date) * 1000)::BIGINT`
— защита от отрицательных значений (clock skew / ручная правка insert_date).

## Откат

```sql
DROP TRIGGER IF EXISTS slicer_archive_rgst3_delete_trg ON rgst3_dishstoplist;
DROP FUNCTION IF EXISTS slicer_archive_rgst3_delete();
```

Две строчки. После отката поведение rgst3 возвращается к исходному —
модуль перестаёт захватывать DELETE, снятия стопов кассиров снова теряются.

## Побочные эффекты

- **Влияние на производительность `DELETE rgst3_dishstoplist`**: добавляется
  один `SELECT` (ctlg15_dishes), один `SELECT` (slicer_kds_sync_config) и
  один `INSERT` (slicer_stop_history). Все по индексам, ~1–2 мс на DELETE.
  Для типичной нагрузки ресторана (десятки DELETE в день) незаметно.
- **Транзакционность**: триггер внутри того же транзакционного контекста,
  что и DELETE. Если наш INSERT в `slicer_stop_history` упадёт (очень
  маловероятно — FK нет, constraints простые) — DELETE откатится.
  Для DBA: это **допустимое** поведение, т.к. данные гарантированно
  консистентны. Если совсем хочется иммунитета — можно превратить триггер
  в AFTER DELETE с `EXCEPTION WHEN OTHERS THEN … RAISE WARNING`.
- **Логирование PostgreSQL**: триггер не пишет в log. Если в проде нужен
  аудит (кто и когда снимал стопы) — `RAISE NOTICE` в функции.

## Проверка после применения

```sql
-- 1. Триггер существует
SELECT tgname FROM pg_trigger WHERE tgname = 'slicer_archive_rgst3_delete_trg';
-- Должен вернуть 1 строку.

-- 2. Функция существует
SELECT proname FROM pg_proc WHERE proname = 'slicer_archive_rgst3_delete';
-- Должен вернуть 1 строку.

-- 3. Тестовый цикл: INSERT + DELETE → новая строка в slicer_stop_history
-- (аналогично server/migrations/011_rgst3_archive_trigger.sql E2E тесту в задаче)
```
