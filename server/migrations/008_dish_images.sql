-- ============================================================================
-- Миграция 008: slicer_dish_images
-- Дата: 2026-04-19
--
-- Хранит путь к загруженной картинке блюда. Сами файлы лежат на диске в
-- server/public/images/dishes/, а в БД — только путь. Это в разы быстрее
-- чем хранить Base64 в TEXT (см. slicer_ingredients.image_url — так было
-- сделано у ингредиентов, для блюд с 700+ позициями это неприемлемо по
-- размеру payload'а /api/dishes).
--
-- Почему отдельная таблица, а не колонка:
-- - Блюда живут в чужой ctlg15_dishes, туда мы не пишем (правило
--   неприкосновенности).
-- - Своей таблицы «slicer_dishes» у нас нет; slicer_dish_categories /
--   _stoplist / _aliases имеют свои специфичные PK и не подходят для
--   хранения 1-to-1 атрибутов блюда.
-- ============================================================================

CREATE TABLE IF NOT EXISTS slicer_dish_images (
  dish_id       VARCHAR(255) PRIMARY KEY,  -- ctlg15_dishes.suuid (чужая таблица, без FK)
  image_path    TEXT         NOT NULL,     -- Относительный URL: /images/dishes/<uuid>.<ext>
  content_type  VARCHAR(50),               -- image/jpeg, image/png, image/webp — для отладки/санитайза
  file_size     INT,                       -- Размер в байтах — для мониторинга/лимитов
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE slicer_dish_images IS
  'Фото блюд, загруженные нарезчиком через UI Рецептов. '
  'image_path — относительный URL (/images/dishes/<uuid>.<ext>), '
  'файлы физически лежат в server/public/images/dishes/. '
  'Раздаются Express-статикой в dev, через nginx/прокси в проде.';

COMMENT ON COLUMN slicer_dish_images.dish_id IS
  'UUID блюда из ctlg15_dishes.suuid (чужая таблица). '
  'При алиасах пишем на конкретный dish_id (не на primary) — чтобы нарезчик '
  'мог загрузить разное фото для разных вариантов, если ему это нужно.';
