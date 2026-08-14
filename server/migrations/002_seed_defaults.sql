-- ============================================================================
-- Миграция 002: Начальные данные для модуля нарезчика
-- Вставляет настройки по умолчанию и базовые категории.
-- ============================================================================

-- Настройки по умолчанию (singleton)
INSERT INTO slicer_settings DEFAULT VALUES
ON CONFLICT (id) DO NOTHING;

-- Базовые категории (порядок сортировки для COURSE_FIFO).
--
-- ⚠️ Проверка идёт через NOT EXISTS по имени, а НЕ через ON CONFLICT DO NOTHING.
-- Раньше стояло `ON CONFLICT DO NOTHING` без указания конфликтующего поля, но
-- уникального ограничения на name нет, а id генерируется через gen_random_uuid() —
-- значит конфликта не возникало НИКОГДА. Каждый повторный прогон `npm run migrate`
-- (а перезапуск после падения посреди миграций — естественная реакция инженера)
-- добавлял ещё пять категорий-дублей с теми же sort_index, ломая и списки в UI,
-- и ранжирование COURSE_FIFO.
INSERT INTO slicer_categories (name, sort_index)
SELECT v.name, v.sort_index
  FROM (VALUES
    ('VIP', 0),
    ('Супы', 1),
    ('Салаты', 2),
    ('Горячее', 3),
    ('Десерты', 4)
  ) AS v(name, sort_index)
 WHERE NOT EXISTS (
   SELECT 1 FROM slicer_categories c WHERE c.name = v.name
 );
