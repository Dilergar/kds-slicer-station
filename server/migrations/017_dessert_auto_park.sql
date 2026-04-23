-- ============================================================================
-- Миграция 017: Авто-парковка десертов
-- Дата: 2026-04-23
--
-- Зачем:
--   Десерты официанты заказывают сразу со всем столом, но гости обычно сами
--   сигналят когда начать готовку (средняя пауза — 30-40 мин). Без авто-парковки
--   карточка десерта сразу падает в очередь нарезчика и сбивает FIFO/course_fifo.
--   Делаем правило: при первом появлении дессертной позиции в GET /api/orders
--   она сразу уходит в PARKED со временем авто-возврата (order_time + X мин).
--   Нарезчик может вернуть её раньше вручную как любую другую парковку.
--
-- Что добавляется в slicer_settings (отдельную таблицу не заводим —
--   попросил хранить в существующей):
--   1) dessert_category_id       — UUID slicer_categories.id, к которой
--      применяется правило. NULL = правило отключено. Seed автоматически
--      ищет категорию «Десерты» / «Dessert» / «Desserts» (без учёта регистра).
--   2) dessert_auto_park_enabled — глобальный тумблер (BOOL, default false).
--      Даже если выбрана категория, авто-парковка не случится пока не ВКЛ.
--   3) dessert_auto_park_minutes — на сколько минут парковать (INT 1..240,
--      default 40 — среднее время между заказом и сигналом гостя).
--
-- Защита от удаления категории: backend DELETE /api/categories/:id будет
-- отказывать если id совпадает с dessert_category_id. Миграция ничего дополнительно
-- на БД не блокирует — проверка в коде маршрута (чужую схему не трогаем).
--
-- Чужая схема (ctlg*, docm2_*, rgst*) НЕ трогается.
-- ============================================================================

ALTER TABLE slicer_settings
  ADD COLUMN IF NOT EXISTS dessert_category_id       UUID    NULL,
  ADD COLUMN IF NOT EXISTS dessert_auto_park_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dessert_auto_park_minutes INT     NOT NULL DEFAULT 40;

-- Валидатор: минуты в разумных пределах. 240 — потолок на случай ужина со
-- сладкой тарелкой через 4 часа; меньше 1 — бессмысленно.
ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_dessert_auto_park_minutes_valid;
ALTER TABLE slicer_settings
  ADD CONSTRAINT slicer_settings_dessert_auto_park_minutes_valid
  CHECK (dessert_auto_park_minutes BETWEEN 1 AND 240);

-- FK на slicer_categories с ON DELETE SET NULL — если кто-то руками (или
-- через нашу же проверку, которую обошли) удалил категорию, настройка
-- обнулится и правило просто перестанет срабатывать, а не сломает constraint.
ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_dessert_category_fk;
ALTER TABLE slicer_settings
  ADD CONSTRAINT slicer_settings_dessert_category_fk
  FOREIGN KEY (dessert_category_id)
  REFERENCES slicer_categories(id) ON DELETE SET NULL;

COMMENT ON COLUMN slicer_settings.dessert_category_id IS
  'UUID slicer_categories.id, на которую применяется авто-парковка. '
  'NULL = правило отключено / категория не настроена. '
  'Seed-ом ищется по имени ("Десерты"/"Dessert"/"Desserts").';
COMMENT ON COLUMN slicer_settings.dessert_auto_park_enabled IS
  'Глобальный тумблер авто-парковки десертов. Даже при заполненном '
  'dessert_category_id правило не применяется пока здесь FALSE.';
COMMENT ON COLUMN slicer_settings.dessert_auto_park_minutes IS
  'На сколько минут от docm2tabl1_ordertime уходит в парковку десертная '
  'позиция при первом появлении в GET /api/orders. 1..240, default 40.';

-- Seed: если категория «Десерты» уже есть — привязываем к ней автоматически.
-- Учитываем 3 варианта написания (кириллица/англ ед./англ мн.), без учёта регистра.
UPDATE slicer_settings
   SET dessert_category_id = (
        SELECT id FROM slicer_categories
         WHERE LOWER(name) IN ('десерты', 'dessert', 'desserts')
         ORDER BY sort_index ASC
         LIMIT 1
       )
 WHERE id = 1
   AND dessert_category_id IS NULL;
