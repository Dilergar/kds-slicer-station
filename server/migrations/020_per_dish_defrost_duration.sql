-- ============================================================================
-- Миграция 020: Per-dish время разморозки
-- Дата: 2026-04-23
--
-- Что меняется:
--   1) В slicer_dish_defrost добавляется колонка defrost_duration_minutes
--      (INT 1..60, NOT NULL DEFAULT 15). У каждого блюда — своё время.
--   2) Значение в существующих строках копируется из slicer_settings.defrost_duration_minutes
--      (Вариант А — сохраняем текущее настроенное поведение для уже
--      размечённой рыбы, чтобы миграция не меняла длительность «на ходу»).
--   3) slicer_settings.defrost_duration_minutes удаляется — глобальная
--      настройка больше не нужна, время задаётся в RecipeEditor на блюдо.
--
-- Что НЕ меняется:
--   - slicer_settings.enable_defrost_sound — это реально глобальный toggle,
--     остаётся как есть.
--   - slicer_order_state.defrost_duration_seconds — snapshot в момент старта
--     таймера, защищает активные разморозки от изменений настройки. Источник
--     значения при INSERT'е теперь slicer_dish_defrost, а не slicer_settings.
--
-- Чужая схема (ctlg*, docm2_*, rgst*) НЕ трогается.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Колонка defrost_duration_minutes в slicer_dish_defrost
-- ----------------------------------------------------------------------------
ALTER TABLE slicer_dish_defrost
  ADD COLUMN IF NOT EXISTS defrost_duration_minutes INT NOT NULL DEFAULT 15;

ALTER TABLE slicer_dish_defrost
  DROP CONSTRAINT IF EXISTS slicer_dish_defrost_duration_valid;
ALTER TABLE slicer_dish_defrost
  ADD CONSTRAINT slicer_dish_defrost_duration_valid
  CHECK (defrost_duration_minutes BETWEEN 1 AND 60);

COMMENT ON COLUMN slicer_dish_defrost.defrost_duration_minutes IS
  'Время разморозки в минутах (1..60) для этого блюда. Snapshot копируется в '
  'slicer_order_state.defrost_duration_seconds в момент клика ❄️ — дальнейшие '
  'изменения этой колонки не сбивают таймер уже запущенных разморозок.';

-- ----------------------------------------------------------------------------
-- 2. Перенос текущего глобального значения в per-dish записи (Вариант А).
-- Делаем ДО удаления колонки из slicer_settings, иначе значение потеряется.
-- Обновляем только существующие строки — ON CONFLICT при создании новых
-- записей в RecipeEditor всё равно будет писать переданное пользователем число.
-- ----------------------------------------------------------------------------
UPDATE slicer_dish_defrost dd
SET defrost_duration_minutes = s.defrost_duration_minutes
FROM slicer_settings s
WHERE s.id = 1;

-- ----------------------------------------------------------------------------
-- 3. Удаление глобальной настройки defrost_duration_minutes
-- ----------------------------------------------------------------------------
ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_defrost_duration_valid;

ALTER TABLE slicer_settings
  DROP COLUMN IF EXISTS defrost_duration_minutes;
