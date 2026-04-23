-- ============================================================================
-- Миграция 012: триггер slicer_archive_rgst3_delete пишет target_name с code
-- Дата: 2026-04-19
--
-- Проблема: в ctlg15_dishes часто лежат 2 блюда с одинаковым name (зал и
-- доставка, например "Дуфу острая" под кодами 184 и Д184). Триггер 011
-- писал только name → в истории появлялись 2 записи с одинаковым именем,
-- которые Dashboard сливал в одну группу и получал double-count времени
-- простоя.
--
-- Фикс: target_name = <code> <name> (если code непустой) или <name>. Теперь
-- "Д184 Дуфу острая" и "184 Дуфу острая" — два разных имени → Dashboard
-- не сливает их в одну карточку по умолчанию.
--
-- Если нарезчик явно свяжет эти блюда алиасом (UI Рецепты → Связать),
-- GET /api/stoplist/history подменит target_name на имя primary блюда.
-- Тогда обе записи сольются под одной карточкой и union уберёт дубли
-- времени простоя. См. server/src/routes/stoplist.ts.
-- ============================================================================

CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete() RETURNS trigger AS $$
DECLARE
  v_dish_code TEXT;
  v_dish_name TEXT;
  v_full_name TEXT;
  v_our_inserter TEXT;
BEGIN
  -- Защита от дубликатов при двусторонней синхронизации — как в миграции 011.
  SELECT inserter_text INTO v_our_inserter
    FROM slicer_kds_sync_config
    WHERE id = 1;

  IF v_our_inserter IS NOT NULL
     AND OLD.inserter IS NOT NULL
     AND OLD.inserter = v_our_inserter
  THEN
    RETURN OLD;
  END IF;

  -- Забираем code И name из ctlg15_dishes.
  SELECT code, name INTO v_dish_code, v_dish_name
    FROM ctlg15_dishes
    WHERE suuid = OLD.rgst3_ctlg15_uuid__dish;

  -- Формат как на доске KDS: "<code> <name>" или fallback.
  IF v_dish_code IS NOT NULL AND v_dish_code <> '' THEN
    v_full_name := v_dish_code || ' ' || COALESCE(v_dish_name, 'Unknown dish');
  ELSE
    v_full_name := COALESCE(v_dish_name, 'Unknown dish');
  END IF;

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
    v_full_name,
    OLD.insert_date,
    NOW(),
    NULLIF(OLD.comment, ''),
    GREATEST(0, EXTRACT(EPOCH FROM NOW() - OLD.insert_date) * 1000)::BIGINT
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION slicer_archive_rgst3_delete() IS
  'Триггер-архиватор (обновлено в миграции 012): target_name = <code> <name>. '
  'Различает зал и доставку по коду (184 / Д184), Dashboard не сливает их '
  'в одну группу по умолчанию. При явной связи через slicer_dish_aliases '
  '— GET /api/stoplist/history делает alias-resolve и объединяет.';

-- Обновляем существующие записи с target_type='dish' — добавляем префикс code
-- если его ещё нет. Для 5 моих E2E-записей и возможных ручных стопов.
UPDATE slicer_stop_history h
   SET target_name = d.code || ' ' || d.name
  FROM ctlg15_dishes d
 WHERE h.target_type = 'dish'
   AND d.suuid::text = h.target_id
   AND d.code IS NOT NULL
   AND d.code <> ''
   AND h.target_name NOT LIKE d.code || ' %';
