-- ============================================================================
-- Миграция 011: Архивация стопов основной KDS в slicer_stop_history
-- Дата: 2026-04-19
--
-- Проблема:
--   rgst3_dishstoplist (чужая таблица основной KDS) при снятии стопа кассиром
--   делает DELETE row. Никакой записи истории не остаётся. Через месяц наш
--   отчёт в Dashboard не увидит ни одного стопа, кроме тех, что ставил сам
--   нарезчик.
--
-- Решение:
--   BEFORE DELETE триггер на rgst3_dishstoplist — перед фактическим удалением
--   копирует данные OLD row в slicer_stop_history (наша таблица). Получаем
--   полный архив всех снятий: кто, когда поставил, когда сняли, длительность.
--
-- Важно:
--   - Триггер НЕ меняет схему rgst3_dishstoplist, НЕ блокирует DELETE,
--     НЕ влияет на логику основной KDS. Только читает OLD и пишет в нашу
--     таблицу. При откате (DROP TRIGGER) — следов в чужой схеме ноль.
--   - Стопы дожившие до конца смены (DELETE не было) триггер НЕ увидит.
--     Они остаются в rgst3 архиве и читаются UNION'ом в GET /api/stoplist/history
--     (см. server/src/routes/stoplist.ts).
--   - Защита от дубликатов при включённой двусторонней синхронизации:
--     если DELETE инициировал наш модуль (OLD.inserter = inserter_text из
--     slicer_kds_sync_config), триггер пропускает запись. Наш код уже
--     сам записал историю через /api/stoplist/toggle или recalculateCascadeStops.
-- ============================================================================

CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete() RETURNS trigger AS $$
DECLARE
  v_dish_name TEXT;
  v_our_inserter TEXT;
BEGIN
  -- Защита от дубликатов: если это наш модуль удалил row (двусторонняя
  -- синхронизация включена), пропускаем — slicer_stop_history уже заполнен
  -- нашим кодом через routes/stoplist.ts (toggle/cascade).
  SELECT inserter_text INTO v_our_inserter
    FROM slicer_kds_sync_config
    WHERE id = 1;

  IF v_our_inserter IS NOT NULL
     AND OLD.inserter IS NOT NULL
     AND OLD.inserter = v_our_inserter
  THEN
    RETURN OLD;
  END IF;

  -- Имя блюда из чужой ctlg15_dishes. Если не нашлось — fallback.
  SELECT name INTO v_dish_name
    FROM ctlg15_dishes
    WHERE suuid = OLD.rgst3_ctlg15_uuid__dish;

  INSERT INTO slicer_stop_history (
    target_type,
    target_id,
    target_name,
    stopped_at,
    resumed_at,
    reason,
    duration_ms
  ) VALUES (
    'dish',
    OLD.rgst3_ctlg15_uuid__dish::text,
    COALESCE(v_dish_name, 'Unknown dish'),
    OLD.insert_date,
    NOW(),
    NULLIF(OLD.comment, ''),  -- пустая строка → NULL, чтобы не захламлять
    GREATEST(0, EXTRACT(EPOCH FROM NOW() - OLD.insert_date) * 1000)::BIGINT
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION slicer_archive_rgst3_delete() IS
  'Триггер-архиватор: при каждом DELETE из rgst3_dishstoplist пишет строку '
  'в slicer_stop_history с полным интервалом [insert_date; NOW()]. '
  'Пропускает DELETE инициированные самим модулем нарезчика (защита от дубликатов '
  'при двусторонней синхронизации).';

DROP TRIGGER IF EXISTS slicer_archive_rgst3_delete_trg ON rgst3_dishstoplist;
CREATE TRIGGER slicer_archive_rgst3_delete_trg
  BEFORE DELETE ON rgst3_dishstoplist
  FOR EACH ROW
  EXECUTE FUNCTION slicer_archive_rgst3_delete();

COMMENT ON TRIGGER slicer_archive_rgst3_delete_trg ON rgst3_dishstoplist IS
  'Архивирует снятые стопы кассиров в slicer_stop_history. Миграция 011.';
