-- ============================================================================
-- Миграция 007: Добавить finished_at в slicer_order_state
-- База данных: arclient (PostgreSQL 12+)
-- Дата: 2026-04-18
--
-- Контекст: модуль нарезчика больше НЕ пишет в docm2tabl1_items.docm2tabl1_cooked.
-- Статус завершения нарезки хранится в slicer_order_state.status = 'COMPLETED',
-- а точный момент нажатия «Готово» — в новой колонке finished_at.
--
-- Зачем: даёт возможность измерять «время готовки повара» как разницу между
--   slicer_order_state.finished_at  (нарезчик закончил)
--   docm2tabl1_items.docm2tabl1_cooktime  (раздача отметила приготовленным)
-- для позиций где обе метки заполнены.
-- ============================================================================

ALTER TABLE slicer_order_state
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

COMMENT ON COLUMN slicer_order_state.finished_at IS
  'Момент когда нарезчик нажал «Готово» (status перешёл в COMPLETED). '
  'NULL для ACTIVE/PARKED/CANCELLED. '
  'Используется в паре с docm2tabl1_items.docm2tabl1_cooktime для измерения '
  'времени готовки повара: cooktime - finished_at.';

-- Индекс для отчёта «время готовки повара» — JOIN по order_item_id
-- + фильтр по временному окну на finished_at.
CREATE INDEX IF NOT EXISTS idx_slicer_order_state_finished_at
  ON slicer_order_state(finished_at)
  WHERE finished_at IS NOT NULL;
