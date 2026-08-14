-- ============================================================================
-- 027_history_fractional_quantity.sql
--
-- Дробное количество порций в истории заказов.
--
-- ПРОБЛЕМА. Количество в позиции чека заказчика — docm2tabl1_items.docm2tabl1_quantity
-- типа NUMERIC(21,3), то есть весовые позиции (0.35 порции / кг) там предусмотрены
-- на уровне схемы. А наша slicer_order_history.total_quantity была INT NOT NULL.
-- Клиент считает totalQuantity как сумму quantity_stack, то есть напрямую из этого
-- NUMERIC. При дробном значении INSERT падал с 22P02 (invalid input syntax for
-- type integer), транзакция откатывалась, POST /complete отдавал 500, клиент в
-- catch перезагружал доску — и карточка возвращалась. Нарезчик не мог отдать
-- такую позицию ВООБЩЕ, только «Отмена» (то есть с потерей записи в отчётах).
--
-- РЕШЕНИЕ. NUMERIC(21,3) — тот же тип и та же точность, что у источника.
-- Расширение типа безопасно: все существующие целые значения сохраняются как есть,
-- ограничение NOT NULL остаётся.
--
-- ⚠️ Node-postgres отдаёт NUMERIC строкой, поэтому в server/src/routes/history.ts
-- маппер приводит значение через Number() — иначе на клиенте вместо сложения
-- получилась бы конкатенация строк.
--
-- Идемпотентна: повторный прогон не меняет уже приведённую колонку.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'slicer_order_history'
       AND column_name = 'total_quantity'
       AND data_type = 'integer'
  ) THEN
    ALTER TABLE slicer_order_history
      ALTER COLUMN total_quantity TYPE NUMERIC(21,3);
    RAISE NOTICE 'slicer_order_history.total_quantity: INT -> NUMERIC(21,3)';
  ELSE
    RAISE NOTICE 'slicer_order_history.total_quantity уже не INT — пропускаем';
  END IF;
END $$;

COMMENT ON COLUMN slicer_order_history.total_quantity IS
  'Количество отданных порций. NUMERIC(21,3) — как docm2tabl1_quantity у заказчика: бывают весовые позиции.';
