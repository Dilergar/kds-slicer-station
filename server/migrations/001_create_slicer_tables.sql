-- ============================================================================
-- Миграция 001: Создание таблиц модуля нарезчика (Slicer Station)
-- База данных: arclient (PostgreSQL 18)
-- Дата: 2026-04-10
--
-- Все таблицы имеют префикс slicer_ для изоляции от основной KDS-системы.
-- Существующие таблицы KDS (docm2_*, ctlg*, rgst*) НЕ модифицируются.
-- ============================================================================

-- Расширение для генерации UUID (если ещё не установлено)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. slicer_categories — Категории блюд с порядком сортировки
-- Используется для COURSE_FIFO сортировки и группировки на KDS-доске.
-- sort_index определяет приоритет: 0 = VIP (наивысший).
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    sort_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. slicer_ingredients — Справочник ингредиентов с иерархией parent→child
-- Двухуровневая структура: Родитель (Картофель) → Разновидность (Сырой, Пюре)
-- Стоп родителя каскадирует на всех детей (логика на backend).
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES slicer_ingredients(id) ON DELETE CASCADE,
    image_url TEXT,
    unit_type VARCHAR(10) NOT NULL DEFAULT 'kg' CHECK (unit_type IN ('kg', 'piece')),
    piece_weight_grams NUMERIC(10,2),
    is_stopped BOOLEAN NOT NULL DEFAULT FALSE,
    stop_reason VARCHAR(255),
    stop_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для быстрого поиска детей по родителю
CREATE INDEX IF NOT EXISTS idx_slicer_ingredients_parent ON slicer_ingredients(parent_id);
-- Частичный индекс для быстрого поиска остановленных ингредиентов
CREATE INDEX IF NOT EXISTS idx_slicer_ingredients_stopped ON slicer_ingredients(is_stopped) WHERE is_stopped = TRUE;

-- ============================================================================
-- 3. slicer_recipes — Связь блюдо→ингредиент с граммовкой на порцию
-- dish_id ссылается на ctlg15_dishes.suuid (существующая таблица KDS).
-- Тип VARCHAR, а не UUID FK, т.к. блюда в чужой таблице.
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id VARCHAR(255) NOT NULL,
    ingredient_id UUID NOT NULL REFERENCES slicer_ingredients(id) ON DELETE CASCADE,
    quantity_per_portion NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dish_id, ingredient_id)
);

-- Индекс для быстрого поиска рецепта по блюду
CREATE INDEX IF NOT EXISTS idx_slicer_recipes_dish ON slicer_recipes(dish_id);

-- ============================================================================
-- 4. slicer_order_state — Теневая таблица состояния заказов нарезчика
-- Хранит статус, парковку и merge-состояние поверх docm2tabl1_items.
-- order_item_id = docm2tabl1_items.suuid (связь с позицией заказа KDS).
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_order_state (
    order_item_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PARKED', 'COMPLETED', 'CANCELLED')),
    quantity_stack JSONB NOT NULL DEFAULT '[1]',
    table_stack JSONB NOT NULL DEFAULT '[[]]',
    parked_at TIMESTAMPTZ,
    unpark_at TIMESTAMPTZ,
    accumulated_time_ms BIGINT DEFAULT 0,
    was_parked BOOLEAN DEFAULT FALSE,
    parked_tables JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для polling активных заказов
CREATE INDEX IF NOT EXISTS idx_slicer_order_state_status ON slicer_order_state(status);
-- Индекс для авто-разпарковки (WHERE status='PARKED' AND unpark_at <= NOW())
CREATE INDEX IF NOT EXISTS idx_slicer_order_state_unpark ON slicer_order_state(unpark_at) WHERE status = 'PARKED';

-- ============================================================================
-- 5. slicer_order_history — Завершённые заказы для KPI-отчётов
-- Содержит snapshot полного заказа и consumed_ingredients для отчёта расхода.
-- was_parked разделяет KPI: обычные vs паркованные заказы.
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_order_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id VARCHAR(255) NOT NULL,
    dish_name VARCHAR(255) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_quantity INT NOT NULL,
    prep_time_ms BIGINT NOT NULL,
    was_parked BOOLEAN DEFAULT FALSE,
    snapshot JSONB,
    consumed_ingredients JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для фильтрации по дате (Dashboard date range)
CREATE INDEX IF NOT EXISTS idx_slicer_order_history_time ON slicer_order_history(completed_at);
-- Индекс для разделения KPI (parked vs non-parked)
CREATE INDEX IF NOT EXISTS idx_slicer_order_history_parked ON slicer_order_history(was_parked);

-- ============================================================================
-- 6. slicer_ingredient_consumption — Расход ингредиентов при завершении заказов
-- Отдельная таблица (не только JSONB в order_history) для SQL-агрегации:
-- SELECT ingredient_id, SUM(weight_grams) GROUP BY ingredient_id
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_ingredient_consumption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_history_id UUID NOT NULL REFERENCES slicer_order_history(id) ON DELETE CASCADE,
    ingredient_id UUID REFERENCES slicer_ingredients(id) ON DELETE SET NULL,
    ingredient_name VARCHAR(255) NOT NULL,
    unit_type VARCHAR(10) NOT NULL,
    quantity NUMERIC(10,2) NOT NULL,
    weight_grams NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для агрегации расхода по ингредиенту
CREATE INDEX IF NOT EXISTS idx_slicer_consumption_ingredient ON slicer_ingredient_consumption(ingredient_id);
-- Индекс для связи с историей заказов
CREATE INDEX IF NOT EXISTS idx_slicer_consumption_order ON slicer_ingredient_consumption(order_history_id);

-- ============================================================================
-- 7. slicer_stop_history — История стопов для Dashboard (% времени на стопе)
-- target_type: 'ingredient' или 'dish'
-- duration_ms вычисляется при снятии со стопа (resumed_at - stopped_at)
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_stop_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('ingredient', 'dish')),
    target_id VARCHAR(255) NOT NULL,
    target_name VARCHAR(255) NOT NULL,
    stopped_at TIMESTAMPTZ NOT NULL,
    resumed_at TIMESTAMPTZ,
    reason VARCHAR(255),
    duration_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для поиска по целевому объекту
CREATE INDEX IF NOT EXISTS idx_slicer_stop_history_target ON slicer_stop_history(target_id);
-- Индекс для фильтрации по дате
CREATE INDEX IF NOT EXISTS idx_slicer_stop_history_time ON slicer_stop_history(stopped_at);

-- ============================================================================
-- 8. slicer_settings — Настройки модуля нарезчика (singleton: одна строка)
-- CHECK (id = 1) гарантирует что в таблице всегда только одна запись.
-- ============================================================================
CREATE TABLE IF NOT EXISTS slicer_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    aggregation_window_minutes INT NOT NULL DEFAULT 5,
    history_retention_minutes INT NOT NULL DEFAULT 15,
    active_priority_rules JSONB NOT NULL DEFAULT '["ULTRA", "COURSE_FIFO"]',
    course_window_seconds INT NOT NULL DEFAULT 10,
    restaurant_open_time VARCHAR(5) NOT NULL DEFAULT '12:00',
    restaurant_close_time VARCHAR(5) NOT NULL DEFAULT '23:59',
    excluded_dates JSONB NOT NULL DEFAULT '[]',
    enable_aggregation BOOLEAN NOT NULL DEFAULT FALSE,
    enable_smart_aggregation BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
