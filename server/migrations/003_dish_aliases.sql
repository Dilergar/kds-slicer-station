-- ============================================================================
-- Миграция 003: Алиасы блюд для общего рецепта
--
-- Задача: блюда-варианты (например "163 Баклажаны" и "Д163 Баклажаны") —
-- это одно и то же блюдо для нарезчика (режет одинаково). Чтобы не дублировать
-- рецепты, вводим концепцию primary/alias: у primary блюда рецепт в slicer_recipes,
-- alias-блюда ссылаются на него через эту таблицу.
--
-- Поведение:
-- - Блюдо-primary НЕ имеет записи в slicer_dish_aliases
-- - Блюдо-alias имеет запись (alias_dish_id → primary_dish_id)
-- - alias_dish_id = PRIMARY KEY → одно блюдо = один рецепт (не может быть
--   алиасом двух разных primary одновременно)
-- - Удаление primary не предусмотрено FK (ctlg15_dishes чужая таблица,
--   нельзя создавать FK ON DELETE) — на уровне приложения должен быть fallback
-- ============================================================================

CREATE TABLE IF NOT EXISTS slicer_dish_aliases (
    alias_dish_id VARCHAR(255) PRIMARY KEY,
    primary_dish_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для быстрого поиска всех алиасов конкретного primary (для UI и агрегации)
CREATE INDEX IF NOT EXISTS idx_slicer_dish_aliases_primary
    ON slicer_dish_aliases(primary_dish_id);
