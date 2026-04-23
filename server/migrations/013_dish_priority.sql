-- ============================================================================
-- Миграция 013: slicer_dish_priority
-- Дата: 2026-04-19
--
-- В RecipeEditor (админка «Рецепты») нарезчик назначает каждому блюду
-- приоритет: NORMAL (1) или ULTRA (3). Раньше выбор в UI менял только локальный
-- state компонента и сбрасывался при перезагрузке — priority_flag в GET /api/dishes
-- был захардкожен в 1. Теперь персистим per-dish (на уровне dish_id, как и
-- slicer_dish_categories) — у primary и alias могут быть разные приоритеты,
-- т.к. в UI они показываются разными карточками.
--
-- Храним только явно выставленные значения: если записи нет → NORMAL (дефолт
-- в GET /api/dishes через COALESCE). UPSERT при save, DELETE при сбросе
-- slicer-data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS slicer_dish_priority (
  dish_id       TEXT        PRIMARY KEY,
  priority_flag INTEGER     NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slicer_dish_priority_flag_valid CHECK (priority_flag IN (1, 3))
);

COMMENT ON TABLE slicer_dish_priority IS
  'Приоритет отображения блюда на доске нарезчика: 1=NORMAL, 3=ULTRA. '
  'Связь с ctlg15_dishes.suuid через dish_id (TEXT, без FK — чужая таблица). '
  'Отсутствие записи = NORMAL. Управляется через RecipeEditor (админка «Рецепты»).';

COMMENT ON COLUMN slicer_dish_priority.priority_flag IS
  '1 = NORMAL (обычный), 3 = ULTRA (всегда наверху очереди). '
  'Значения соответствуют enum PriorityLevel в types.ts.';
