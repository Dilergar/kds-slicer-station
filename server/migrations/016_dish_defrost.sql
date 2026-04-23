-- ============================================================================
-- Миграция 016: Блюда с обязательной разморозкой (для замороженных блюд — рыба)
-- Дата: 2026-04-23
--
-- Что добавляется:
--   1) slicer_settings.defrost_duration_minutes — глобальное время разморозки
--      (1..60 мин, по умолчанию 15). Одно значение на все блюда — сейчас
--      размораживается только рыба.
--   2) slicer_dish_defrost — per-dish флаг «требует разморозки?». Отсутствие
--      записи = false (дефолт). Аналогично паттерну slicer_dish_priority.
--   3) slicer_order_state.defrost_started_at / defrost_duration_seconds —
--      состояние разморозки для конкретной позиции заказа.
--
-- Семантика состояний карточки:
--   defrost_started_at IS NULL → ожидание, карточка в очереди, кликабельная ❄️
--   NOW() < started + duration → в процессе, мини-карточка в ряду над доской
--   NOW() >= started + duration → разморожено, карточка снова в очереди
--                                  (ULTRA при этом игнорируется)
--
-- Ручное подтверждение («Разморозилась» раньше таймера) реализуется
-- backdate-ом defrost_started_at в прошлое так, чтобы NOW() >= started + duration.
-- Отдельной колонки для этого не заводим — состояние уже выражается этими двумя.
--
-- slicer_dish_defrost привязывается к primary-блюду (через recipe_source_id
-- на чтении в GET /api/dishes, как и рецепт). Алиасы наследуют.
--
-- Чужая схема (ctlg*, docm2_*, rgst*) НЕ трогается.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Глобальная настройка — время разморозки в минутах (1..60, по умолчанию 15)
-- ----------------------------------------------------------------------------
ALTER TABLE slicer_settings
  ADD COLUMN IF NOT EXISTS defrost_duration_minutes INT NOT NULL DEFAULT 15;

ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_defrost_duration_valid;
ALTER TABLE slicer_settings
  ADD CONSTRAINT slicer_settings_defrost_duration_valid
  CHECK (defrost_duration_minutes BETWEEN 1 AND 60);

-- Отдельный toggle для звукового уведомления при готовности разморозки.
-- По умолчанию ВКЛ — ресторан шумный, визуал легко проморгать.
ALTER TABLE slicer_settings
  ADD COLUMN IF NOT EXISTS enable_defrost_sound BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN slicer_settings.defrost_duration_minutes IS
  'Время разморозки в минутах (1..60). Единое для всех блюд с requires_defrost=true.';
COMMENT ON COLUMN slicer_settings.enable_defrost_sound IS
  'Проигрывать звук (Web Audio beep) когда таймер разморозки достиг 0.';

-- ----------------------------------------------------------------------------
-- 2. slicer_dish_defrost — per-dish флаг «требует разморозки?»
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slicer_dish_defrost (
  dish_id          TEXT        PRIMARY KEY,
  requires_defrost BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE slicer_dish_defrost IS
  'Флаг "блюдо требует разморозки перед нарезкой" на уровне dish_id. '
  'Отсутствие записи = FALSE (дефолт). Значение берётся по primary-блюду '
  '(recipe_source_id), алиасы наследуют. Управляется в RecipeEditor.';

COMMENT ON COLUMN slicer_dish_defrost.dish_id IS
  'ctlg15_dishes.suuid (TEXT, без FK — чужая таблица).';
COMMENT ON COLUMN slicer_dish_defrost.requires_defrost IS
  'TRUE = на карточке показывается кликабельная ❄️ для запуска разморозки.';

-- ----------------------------------------------------------------------------
-- 3. Состояние разморозки в slicer_order_state
-- ----------------------------------------------------------------------------
ALTER TABLE slicer_order_state
  ADD COLUMN IF NOT EXISTS defrost_started_at       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS defrost_duration_seconds INT         NULL;

COMMENT ON COLUMN slicer_order_state.defrost_started_at IS
  'Момент запуска разморозки (клик по ❄️ на карточке). NULL = разморозка не запускалась. '
  'Ручное подтверждение «Разморозилась» сдвигает это поле в прошлое на duration+1 секунду — '
  'NOW()-started становится >= duration → таймер считается истёкшим.';

COMMENT ON COLUMN slicer_order_state.defrost_duration_seconds IS
  'Снимок defrost_duration_minutes*60 в момент запуска. Нужен чтобы изменение '
  'глобальной настройки (15→10 мин) в середине активной разморозки не сбивало '
  'таймер у уже запущенных карточек.';

CREATE INDEX IF NOT EXISTS idx_slicer_order_state_defrost_active
  ON slicer_order_state(defrost_started_at)
  WHERE defrost_started_at IS NOT NULL;
