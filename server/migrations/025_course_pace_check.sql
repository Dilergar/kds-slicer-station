-- ============================================================================
-- Миграция 025: CHECK-ограничение на шаг курса (course_pace_seconds)
-- Дата: 2026-07-11
--
-- По итогам полного ревью 2026-07-11: границы 10..3600 проверялись только в
-- API (PUT /api/settings) и в UI, но не в схеме — прямой SQL мог записать 0
-- или отрицательное значение, и умная очередь МОЛЧА деградировала к чистому
-- FIFO (виртуальное время = старт визита + курс × 0), ломая эталонную
-- очередь владельца (см. миграцию 024). Схема — единственный слой, который
-- программисты заказчика гарантированно выполняют при деплое, поэтому
-- инвариант закрепляем в ней (симметрично CHECK'у dessert_auto_park_minutes
-- из миграции 017).
--
-- Перед добавлением ограничения значение клампится в допустимый диапазон —
-- на случай, если в чьей-то БД уже лежит значение вне границ (иначе
-- ADD CONSTRAINT упал бы и остановил npm run migrate).
-- ============================================================================

UPDATE slicer_settings
   SET course_pace_seconds = LEAST(GREATEST(course_pace_seconds, 10), 3600)
 WHERE course_pace_seconds < 10 OR course_pace_seconds > 3600;

ALTER TABLE slicer_settings
  DROP CONSTRAINT IF EXISTS slicer_settings_course_pace_seconds_valid;
ALTER TABLE slicer_settings
  ADD CONSTRAINT slicer_settings_course_pace_seconds_valid
  CHECK (course_pace_seconds BETWEEN 10 AND 3600);
