-- Миграция 006: Двусторонняя синхронизация стоп-листа блюд с основной KDS
--
-- Что добавляется:
-- 1. Колонка slicer_settings.enable_kds_stoplist_sync — главный выключатель.
--    По умолчанию FALSE — модуль ничего не пишет в чужую rgst3_dishstoplist
--    и работает изолированно, как было до этой миграции.
-- 2. Таблица slicer_kds_sync_config — singleton с UUID-ами, нужными для INSERT
--    в rgst3_dishstoplist (restaurant, menu, responsible). Заполняется один раз
--    программистами заказчика при включении синхронизации.
-- 3. Колонка slicer_dish_stoplist.rgst3_row_suuid — линковка нашей строки с
--    созданной нами строкой в rgst3_dishstoplist. Нужна чтобы при снятии стопа
--    удалять РОВНО ту строку, которую мы создали (а не чужие записи).
--
-- ВАЖНО: до включения флага enable_kds_stoplist_sync ничего не меняется.
-- Чтобы включить — см. раздел «Двусторонняя синхронизация стоп-листа» в
-- корневом файле Инструкция.md.

-- 1. Главный выключатель
ALTER TABLE slicer_settings
  ADD COLUMN IF NOT EXISTS enable_kds_stoplist_sync BOOLEAN NOT NULL DEFAULT false;

-- 2. Конфиг для записи в rgst3_dishstoplist
CREATE TABLE IF NOT EXISTS slicer_kds_sync_config (
  -- Singleton: только одна строка (id = 1)
  id                  INTEGER PRIMARY KEY CHECK (id = 1),

  -- UUID ресторана из ctlg11_restaurants — какой ресторан использовать в
  -- INSERT в rgst3_dishstoplist (rgst3_ctlg11_uuid__restaurant).
  restaurant_id       UUID NOT NULL,

  -- UUID меню из ctlg16_restaurantmenu (rgst3_ctlg16_uuid__restaurantmenu).
  menu_id             UUID NOT NULL,

  -- UUID «ответственного сотрудника». Это пользователь, от имени которого
  -- модуль будет ставить блюда на стоп в системе заказчика. Программисты
  -- могут завести специального системного пользователя «slicer-module» в
  -- ctlg10_useremployees или использовать существующий служебный аккаунт.
  responsible_user_id UUID NOT NULL,

  -- Текстовый идентификатор «кто вставил» — пишется в rgst3.inserter/updater.
  -- По умолчанию 'slicer-module', программисты могут поменять под свои стандарты.
  inserter_text       TEXT NOT NULL DEFAULT 'slicer-module',

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE slicer_kds_sync_config IS
  'Singleton-конфиг для двусторонней синхронизации стоп-листа блюд с rgst3_dishstoplist. Заполняется один раз программистами заказчика при включении enable_kds_stoplist_sync.';

-- 3. Линковка наших строк с rgst3
ALTER TABLE slicer_dish_stoplist
  ADD COLUMN IF NOT EXISTS rgst3_row_suuid UUID NULL;

COMMENT ON COLUMN slicer_dish_stoplist.rgst3_row_suuid IS
  'suuid строки в rgst3_dishstoplist, созданной модулем для синхронизации. NULL если синхронизация выключена. Используется для точечного DELETE при снятии стопа.';
