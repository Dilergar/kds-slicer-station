-- Миграция 005: Таблица актуального стоп-листа блюд модуля нарезчика
--
-- Проблема: до этой миграции «текущее состояние стоп-листа блюд» хранилось
-- только во фронтенд-React-state. Ручной стоп блюда не персистился, каскадный
-- (ингредиент → все блюда с ним) тоже. F5 сбрасывал любые стопы блюд.
--
-- Решение: отдельная таблица slicer_dish_stoplist, в которой одна строка
-- = одно остановленное блюдо. Различает MANUAL (поставлен пользователем) и
-- CASCADE (автоматически от стопнутого ингредиента). Ручной стоп всегда
-- побеждает каскадный — если ингредиент вернулся, ручной стоп остаётся.
--
-- slicer_stop_history продолжает вести лог завершённых стопов для Dashboard.

CREATE TABLE IF NOT EXISTS slicer_dish_stoplist (
  -- Теневая ссылка на ctlg15_dishes.suuid (без FK, чужая таблица).
  -- PK гарантирует, что у блюда не может быть двух одновременных стопов.
  dish_id               VARCHAR PRIMARY KEY,

  -- MANUAL  — поставлен пользователем через UI.
  -- CASCADE — автоматически от стопнутого ингредиента (recalculateCascadeStops).
  stop_type             VARCHAR NOT NULL CHECK (stop_type IN ('MANUAL', 'CASCADE')),

  -- Причина стопа для отображения в UI. Для CASCADE — «Missing: <ingredient>».
  reason                TEXT,

  -- Время начала стопа, используется для расчёта duration_ms при снятии.
  stopped_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Только для CASCADE: какой ингредиент заблокировал блюдо.
  -- ON DELETE CASCADE — если ингредиент удаляют совсем, каскадный стоп подчищается.
  cascade_ingredient_id UUID REFERENCES slicer_ingredients(id) ON DELETE CASCADE
);

-- Быстрый поиск каскадных строк по ингредиенту — используется в
-- recalculateCascadeStops при снятии стопа с ингредиента.
CREATE INDEX IF NOT EXISTS idx_slicer_dish_stoplist_cascade_ing
  ON slicer_dish_stoplist(cascade_ingredient_id)
  WHERE stop_type = 'CASCADE';

-- Быстрый UNION с rgst3_dishstoplist в GET /api/dishes.
CREATE INDEX IF NOT EXISTS idx_slicer_dish_stoplist_type
  ON slicer_dish_stoplist(stop_type);
