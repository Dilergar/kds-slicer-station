-- ============================================================================
-- Миграция 009: slicer_ingredients.image_url — переход с Base64 на путь к файлу
-- Дата: 2026-04-19
--
-- До миграции: slicer_ingredients.image_url TEXT хранил Base64 data-URL
--   (data:image/jpeg;base64,...). Для десятков ингредиентов это работало,
--   но это тот же недостаток что был у блюд (см. миграцию 008):
--   - раздутые TEXT-колонки,
--   - data-URL не кэшируется браузером → перекачивается при каждом GET,
--   - API-ответы /api/ingredients распухают.
--
-- После миграции: image_url хранит относительный URL вида
--   /images/ingredients/<id>.<ext>
--   файл лежит на диске в server/public/images/ingredients/
--   раздаётся Express-статикой (dev) / nginx (prod) — тот же путь /images/*
--   что у блюд (миграция 008).
-- ============================================================================

-- Новые колонки для диагностики (симметрично slicer_dish_images).
ALTER TABLE slicer_ingredients
  ADD COLUMN IF NOT EXISTS image_content_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS image_file_size    INT;

COMMENT ON COLUMN slicer_ingredients.image_url IS
  'Относительный URL картинки: /images/ingredients/<id>.<ext>. '
  'Файл лежит на диске в server/public/images/ingredients/. '
  'До миграции 009 здесь хранились Base64 data-URL — они очищены этой миграцией.';

COMMENT ON COLUMN slicer_ingredients.image_content_type IS
  'MIME-тип загруженного файла (image/jpeg, image/png, image/webp, image/gif). '
  'Только для диагностики — выборки по нему не делаются.';

COMMENT ON COLUMN slicer_ingredients.image_file_size IS
  'Размер файла в байтах — для мониторинга общего объёма хранилища.';

-- Очистка устаревших Base64 URL.
-- Раньше в image_url писали data:image/... — после миграции эти строки
-- невалидны как HTTP-URL. Обнуляем, чтобы UI показывал placeholder и
-- пользователь мог перезалить через новый upload-endpoint.
UPDATE slicer_ingredients
   SET image_url = NULL
 WHERE image_url LIKE 'data:%';
