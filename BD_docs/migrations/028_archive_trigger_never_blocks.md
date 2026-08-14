# Миграция 028: триггер-архиватор больше не может заблокировать чужой DELETE

## Дата выполнения
2026-08-14

## Файл
`server/migrations/028_archive_trigger_never_blocks.sql`

## Что делает
`CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete()` — переписывает тело
функции триггера из миграции 021. Сам триггер (`slicer_archive_rgst3_delete_trg`
на `rgst3_dishstoplist`) не пересоздаётся, схема чужой таблицы не меняется.

Идемпотентна: `CREATE OR REPLACE`.

## Зачем
Это **BEFORE DELETE триггер на ЧУЖОЙ таблице** `rgst3_dishstoplist` —
единственное разрешённое исключение из правила 3. Он вставляет строку в
`slicer_stop_history`, и **любая ошибка этой вставки валит всю операцию
удаления**: кассир жмёт «снять со стопа» в основной KDS, получает ошибку и не
может снять стоп. Виноват при этом наш модуль, причём триггер живёт в базе
независимо — наш backend может быть даже не запущен.

Комментарий к миграции 011 утверждал «НЕ блокирует DELETE», но гарантий этого
в коде не было. Полное ревью 2026-08-14 (находка №35) нашло минимум три
незакрытых пути:

| # | Путь | Что происходило |
|---|---|---|
| 1 | `reason VARCHAR(255)` заполнялся из `OLD.comment` без обрезки | Комментарий кассира длиннее 255 символов → `value too long for type character varying(255)` |
| 2 | `stopped_at TIMESTAMPTZ NOT NULL` заполнялся из `OLD.insert_date` без подстраховки | Строка с `insert_date IS NULL` → нарушение NOT NULL |
| 3 | Функция не `SECURITY DEFINER` | Если основная KDS ходит под отдельной ограниченной ролью — `permission denied` на `slicer_stop_history`, `slicer_dish_stoplist`, `slicer_kds_sync_config`, `users` при каждом DELETE |

## Что изменилось

```sql
BEGIN
  -- вся архивация
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'slicer_archive_rgst3_delete: не удалось заархивировать стоп (%): %',
    SQLSTATE, SQLERRM;
END;
RETURN OLD;
```

- **Перехват любых исключений.** Потеря одной строки истории несравнимо дешевле
  заблокированной работы чужой системы. Причина пишется в `WARNING` — пропажу
  можно найти в логе PostgreSQL.
- `LEFT(NULLIF(OLD.comment, ''), 255)` — причина обрезается по длине колонки.
- `COALESCE(OLD.insert_date, NOW())` — и в `stopped_at`, и в расчёте `duration_ms`.
- `SECURITY DEFINER` + `SET search_path = public, pg_temp` — функция выполняется
  с правами владельца (того, кто прогонял миграции), а не роли основной KDS.
  Фиксация `search_path` обязательна для `SECURITY DEFINER`.

## Что НЕ изменилось
Логика определения «наш DELETE» перенесена из миграции 021 без изменений:

1. основной путь — линковка `slicer_dish_stoplist.rgst3_row_suuid = OLD.suuid`
   (колонка типа `UUID`, миграция 006 — сравнение без приведения);
2. fallback (legacy) — `OLD.inserter = slicer_kds_sync_config.inserter_text`
   для orphan-строк, поставленных модулем до миграции 014.

Наши строки по-прежнему пропускаются без архивации: историю по ним пишет сам
модуль, иначе в отчёте были бы дубли.

## Требования к правам
`SECURITY DEFINER` означает, что владелец функции должен иметь `INSERT` на
`slicer_stop_history` и `SELECT` на `slicer_dish_stoplist`,
`slicer_kds_sync_config`, `ctlg15_dishes`, `users`. При стандартном
развёртывании (миграции прогоняются под `postgres`) это выполняется само.

## Откат
Вернуть версию функции из `server/migrations/021_unstop_master_policy.sql`
(прогнать этот файл повторно — он тоже `CREATE OR REPLACE`). Не рекомендуется:
вернётся возможность заблокировать DELETE в системе заказчика.
