# slicer_kds_sync_config — Конфиг двусторонней синхронизации стоп-листа

## Назначение
Singleton-таблица (`id = 1` через CHECK), хранящая идентификаторы из системы
заказчика, необходимые для записи в `rgst3_dishstoplist` при включённой
двусторонней синхронизации.

Заполняется **один раз** программистами заказчика при включении флага
`slicer_settings.enable_kds_stoplist_sync = true`. Без заполнения адаптер
`kdsStoplistSync.ts` бросает явную ошибку и откатывает транзакцию.

По умолчанию таблица **пустая** — пока флаг выключен (false), её содержимое
не используется.

## Колонки

| Колонка | Тип | NOT NULL | Default | Описание |
|---|---|---|---|---|
| `id` | INTEGER | ✅ | — | PK. CHECK (id = 1) — гарантия singleton. |
| `restaurant_id` | UUID | ✅ | — | UUID ресторана из `ctlg11_restaurants.suuid`. Подставляется в `rgst3_ctlg11_uuid__restaurant`. |
| `menu_id` | UUID | ✅ | — | UUID меню из `ctlg16_restaurantmenu.suuid`. Подставляется в `rgst3_ctlg16_uuid__restaurantmenu`. |
| `responsible_user_id` | UUID | ✅ | — | UUID «системного пользователя» нарезчика. Подставляется в `rgst3_ctlg5_uuid__responsible`. |
| `inserter_text` | TEXT | ✅ | `'slicer-module'` | Текстовый идентификатор для `inserter`/`updater` в `rgst3_dishstoplist`. Используется для аудита: «эту строку поставил модуль, а не кассир». |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Когда последний раз меняли конфиг. |

## Индексы
- `slicer_kds_sync_config_pkey` — PK по `id`

## Foreign Keys
Нет — поля `restaurant_id`, `menu_id`, `responsible_user_id` ссылаются на
чужие таблицы (`ctlg*`), формальный FK не ставим, чтобы не привязывать
наш модуль к структуре чужих таблиц.

## Связанные таблицы

| Таблица | Связь |
|---|---|
| `slicer_settings.enable_kds_stoplist_sync` | Главный выключатель — без `true` этот конфиг игнорируется |
| `rgst3_dishstoplist` | Чужая таблица, в которую пишет адаптер при включённом флаге |
| `slicer_dish_stoplist` | Хранит `rgst3_row_suuid` — линковку с записями в чужой таблице |
| `ctlg11_restaurants` | Источник `restaurant_id` |
| `ctlg16_restaurantmenu` | Источник `menu_id` |
| `ctlg10_useremployees` (или аналог) | Источник `responsible_user_id` |

## Примеры

### Заполнить конфиг (один раз при включении синхронизации)
```sql
INSERT INTO slicer_kds_sync_config (
  id, restaurant_id, menu_id, responsible_user_id, inserter_text
) VALUES (
  1,
  '<UUID ресторана>'::uuid,
  '<UUID меню>'::uuid,
  '<UUID ответственного>'::uuid,
  'slicer-module'
)
ON CONFLICT (id) DO UPDATE SET
  restaurant_id       = EXCLUDED.restaurant_id,
  menu_id             = EXCLUDED.menu_id,
  responsible_user_id = EXCLUDED.responsible_user_id,
  inserter_text       = EXCLUDED.inserter_text,
  updated_at          = NOW();
```

### Проверить заполнение
```sql
SELECT * FROM slicer_kds_sync_config;
```

### Очистить (например при откате синхронизации)
```sql
DELETE FROM slicer_kds_sync_config WHERE id = 1;
```

## Включение / выключение
Сам конфиг ничего не делает — он только хранит значения. Запись в
`rgst3_dishstoplist` происходит когда:
1. `slicer_settings.enable_kds_stoplist_sync = true`
2. И этот конфиг заполнен

Полная пошаговая инструкция в `Инструкция.md` → раздел
«Двусторонняя синхронизация стоп-листа (опционально)».
