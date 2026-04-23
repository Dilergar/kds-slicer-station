-- ============================================================================
-- Миграция 003: Таблица ручного назначения slicer-категорий блюдам
-- Дата: 2026-04-13
--
-- Связь blue→category вручную (нарезчик сам назначает блюду категорию в UI
-- «Рецепты»). dish_id ссылается на ctlg15_dishes.suuid (строка, не FK —
-- чужая таблица не трогается). category_id ссылается на slicer_categories.id.
--
-- Одно блюдо может быть в нескольких категориях (до 3, как в UI RecipeEditor).
-- ============================================================================

CREATE TABLE IF NOT EXISTS slicer_dish_categories (
    dish_id VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL REFERENCES slicer_categories(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dish_id, category_id)
);

-- Индекс для быстрого поиска категорий по блюду (используется в GET /api/dishes)
CREATE INDEX IF NOT EXISTS idx_slicer_dish_categories_dish
    ON slicer_dish_categories(dish_id);
