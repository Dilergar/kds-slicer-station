# Миграция 021: Политика «модуль — мастер стоп-листа» для DELETE

## Дата выполнения
2026-04-26

## Файл
`server/migrations/021_unstop_master_policy.sql`

## Что делает
Обновляет функцию `slicer_archive_rgst3_delete()` (триггер на `rgst3_dishstoplist`) — теперь определение «наш DELETE» работает через линковку `slicer_dish_stoplist.rgst3_row_suuid`, а не только через сравнение `OLD.inserter` с `inserter_text` из конфига.

Это ломалось после миграции 014 (per-user атрибуция): наш `inserter` стал хранить `users.uuid::text`, а не статичный `'slicer-module'`, и старая защита от дубликатов в `slicer_stop_history` не срабатывала.

## Изменения в логике триггера

| Что проверяется | До (мигр. 015) | После (мигр. 021) |
|---|---|---|
| Основной критерий «наш DELETE» | `OLD.inserter = config.inserter_text` (static) | `EXISTS slicer_dish_stoplist WHERE rgst3_row_suuid = OLD.suuid` (per-row линковка) |
| Legacy-фолбэк | — | `OLD.inserter = config.inserter_text` (для orphan-ов до per-user) |
| Что записывается в slicer_stop_history | `stopped_by_*` + `actor_source='kds'` | то же самое |

## Совместимо с
- Миграциями 011, 012, 014, 015 (триггер `slicer_archive_rgst3_delete_trg` остаётся тот же, меняется только тело функции).
- Включённой и выключенной двусторонней синхронизацией.

## Связанные изменения в коде
- `server/src/services/kdsStoplistSync.ts` — добавлена функция `pushDishUnstopAll(client, dishId)`, которая удаляет ВСЕ `rgst3_dishstoplist` строки для блюда в текущей открытой смене (наши + кассирские). Триггер 021 правильно отделит наши от чужих и не задвоит историю.
- `server/src/routes/stoplist.ts` — UNSTOP-flow для блюд использует `pushDishUnstopAll` вместо `pushDishUnstop`. Убран блок 409 «это блюдо в стоп-листе основной KDS» — модуль теперь может снимать любые стопы.

## Откат
```sql
-- Восстановить тело функции из миграции 015 (старая логика по inserter_text)
\i server/migrations/015_rgst3_archive_with_actor.sql
```
Триггер не пересоздаётся, только функция перезаписывается (CREATE OR REPLACE FUNCTION).

## Как выполнить
```bash
psql -U postgres -d arclient -v ON_ERROR_STOP=1 \
  -f server/migrations/021_unstop_master_policy.sql
```
Или через `npm run migrate` в `server/`.

## Что проверить после применения
1. Включена ли двусторонняя синхронизация: `SELECT enable_kds_stoplist_sync FROM slicer_settings WHERE id=1;`
2. Если включена — поставь блюдо на стоп через UI модуля под PIN-юзером.
3. Сними стоп.
4. В `slicer_stop_history` для этого блюда должна быть **ровно одна** запись, с `actor_source='slicer'` и заполненными `resumed_by_*` (не дубль с `actor_source='kds'`).
