# Миграция 006: Двусторонняя синхронизация стоп-листа с основной KDS

## Дата выполнения
2026-04-15

## Файл
`server/migrations/006_kds_stoplist_sync.sql`

## Что делает
Готовит инфраструктуру для опциональной двусторонней синхронизации стоп-листа
блюд между модулем нарезчика и основной KDS. **По умолчанию выключена** —
ничего не пишет в чужую `rgst3_dishstoplist` без явного включения.

Изменения:
1. Колонка `slicer_settings.enable_kds_stoplist_sync BOOLEAN NOT NULL DEFAULT false`
   — главный выключатель синхронизации.
2. Новая таблица `slicer_kds_sync_config` (singleton, `id = 1` через CHECK)
   — хранит UUID-ы для INSERT в `rgst3_dishstoplist`:
   - `restaurant_id` UUID — `ctlg11_restaurants.suuid`
   - `menu_id` UUID — `ctlg16_restaurantmenu.suuid`
   - `responsible_user_id` UUID — `ctlg10_useremployees.suuid` (или аналог)
   - `inserter_text` TEXT — текстовый идентификатор для `inserter`/`updater`
3. Колонка `slicer_dish_stoplist.rgst3_row_suuid UUID NULL` — линковка нашей
   строки с зеркальной строкой в `rgst3_dishstoplist` для точного DELETE.

## Зависимости
- Миграция 001 (`slicer_settings`)
- Миграция 005 (`slicer_dish_stoplist`)

## Как выполнить
```bash
PGPASSWORD=<пароль> psql -U postgres -d arclient -v ON_ERROR_STOP=1 \
  -f server/migrations/006_kds_stoplist_sync.sql
```
Или через `npm run migrate` в `server/`.

## Откат
```sql
ALTER TABLE slicer_settings DROP COLUMN IF EXISTS enable_kds_stoplist_sync;
ALTER TABLE slicer_dish_stoplist DROP COLUMN IF EXISTS rgst3_row_suuid;
DROP TABLE IF EXISTS slicer_kds_sync_config;
```

## Связанная backend-логика
- `server/src/services/kdsStoplistSync.ts` — единственный файл, где модуль
  пишет в `rgst3_dishstoplist`. Адаптер с двумя функциями:
  `pushDishStop()` и `pushDishUnstop()`. Обе читают конфиг и проверяют флаг,
  при выключенной синхронизации возвращают null/no-op.
- `server/src/routes/stoplist.ts` — вызывает адаптер при ручном toggle блюда
  и при пересчёте каскадных стопов в `recalculateCascadeStops()`.

## Включение
См. подробную пошаговую инструкцию в корневом файле `Инструкция.md` →
раздел «Двусторонняя синхронизация стоп-листа (опционально)».

Краткое резюме:
1. Найти UUID-ы ресторана / меню / ответственного сотрудника в БД заказчика
2. `INSERT INTO slicer_kds_sync_config ... ON CONFLICT DO UPDATE`
3. `GRANT INSERT, DELETE ON rgst3_dishstoplist TO <user>`
4. `UPDATE slicer_settings SET enable_kds_stoplist_sync = true`
