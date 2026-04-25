-- ============================================================================
-- Миграция 021: Политика «модуль — мастер стоп-листа» для DELETE
-- Дата: 2026-04-26
--
-- Контекст:
--   После миграций 014 (per-user атрибуция) inserter в наших rgst3-строках
--   стал хранить users.uuid::text вместо статичного 'slicer-module'.
--   Старая защита триггера от дубликатов (миграция 015) ломалась — она
--   сравнивала OLD.inserter с config.inserter_text и теперь почти всегда
--   срабатывала по false ветке, давая двойные записи в slicer_stop_history.
--
-- Что меняем:
--   Триггер slicer_archive_rgst3_delete теперь определяет «наш DELETE»
--   через линковку: если OLD.suuid присутствует в slicer_dish_stoplist
--   .rgst3_row_suuid → наш модуль владеет этой строкой и сам напишет
--   историю с resumed_by_*. Триггер пропускает архивацию.
--
--   Дополнительно сохраняем legacy-проверку по inserter_text (на случай
--   старых orphan-ов от предыдущих версий, до per-user атрибуции).
--
-- Что НЕ меняем:
--   - Резолв OLD.inserter → users.uuid → ФИО (миграция 015) — остаётся.
--   - actor_source='kds' для kds-стопов — остаётся.
--   - resumed_by_* всегда NULL для триггера — остаётся.
--
-- Совместимо с миграциями 011, 012, 014, 015.
-- ============================================================================

CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete() RETURNS trigger AS $$
DECLARE
  v_dish_code TEXT;
  v_dish_name TEXT;
  v_full_name TEXT;
  v_our_inserter TEXT;
  v_stopper_uuid UUID;
  v_stopper_name TEXT;
  v_owned_by_us BOOLEAN;
BEGIN
  -- ─── Защита от дубликатов ──────────────────────────────────────────────
  -- Двусторонняя синхронизация может писать историю стопов двумя путями:
  --   1. routes/stoplist.ts (toggle / cascade) — пишет с resumed_by_*
  --   2. этот триггер — пишет без resumed_by_* (для кассиров)
  -- Чтобы не было дублей, триггер пропускает строки, которые ОЧЕВИДНО
  -- наши: либо есть линковка из slicer_dish_stoplist (per-user attrib),
  -- либо OLD.inserter совпадает с config.inserter_text (legacy fallback).

  -- (1) Линковка — основной критерий после миграции 014/021.
  SELECT EXISTS (
    SELECT 1 FROM slicer_dish_stoplist
     WHERE rgst3_row_suuid = OLD.suuid
  ) INTO v_owned_by_us;

  IF v_owned_by_us THEN
    RETURN OLD;
  END IF;

  -- (2) Legacy: устаревший fallback на статичный inserter_text. Срабатывает
  --     для старых orphan-ов, поставленных модулем до миграции 014, либо
  --     для строк, поставленных под актора без ctlg10-маппинга (тогда
  --     inserter = config.inserter_text, обычно 'slicer-module').
  SELECT inserter_text INTO v_our_inserter
    FROM slicer_kds_sync_config
    WHERE id = 1;

  IF v_our_inserter IS NOT NULL
     AND OLD.inserter IS NOT NULL
     AND OLD.inserter = v_our_inserter
  THEN
    RETURN OLD;
  END IF;

  -- ─── Архивация чужого стопа (кассир / пасс / менеджер) ─────────────────
  -- Имя блюда + код (формат "<code> <name>") — как в миграции 012.
  SELECT code, name INTO v_dish_code, v_dish_name
    FROM ctlg15_dishes
    WHERE suuid = OLD.rgst3_ctlg15_uuid__dish;

  IF v_dish_code IS NOT NULL AND v_dish_code <> '' THEN
    v_full_name := v_dish_code || ' ' || COALESCE(v_dish_name, 'Unknown dish');
  ELSE
    v_full_name := COALESCE(v_dish_name, 'Unknown dish');
  END IF;

  -- Резолв актора — как в миграции 015.
  BEGIN
    SELECT u.uuid, TRIM(u.login)
      INTO v_stopper_uuid, v_stopper_name
      FROM users u
      WHERE u.uuid::text = OLD.inserter;
  EXCEPTION WHEN invalid_text_representation THEN
    v_stopper_uuid := NULL;
    v_stopper_name := NULL;
  END;

  IF v_stopper_name IS NULL AND OLD.inserter IS NOT NULL THEN
    v_stopper_name := 'Unknown (' || LEFT(OLD.inserter, 8) || ')';
  END IF;

  INSERT INTO slicer_stop_history (
    target_type,
    target_id,
    target_name,
    stopped_at,
    resumed_at,
    reason,
    duration_ms,
    stopped_by_uuid,
    stopped_by_name,
    actor_source
    -- resumed_by_* остаются NULL — rgst3 не хранит «кто DELETE-нул»
  ) VALUES (
    'dish',
    OLD.rgst3_ctlg15_uuid__dish::text,
    v_full_name,
    OLD.insert_date,
    NOW(),
    NULLIF(OLD.comment, ''),
    GREATEST(0, EXTRACT(EPOCH FROM NOW() - OLD.insert_date) * 1000)::BIGINT,
    v_stopper_uuid,
    v_stopper_name,
    'kds'
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION slicer_archive_rgst3_delete() IS
  'Триггер-архиватор (миграция 021): защита от дубликатов работает через '
  'линковку slicer_dish_stoplist.rgst3_row_suuid (основной путь, per-user '
  'атрибуция) + fallback на config.inserter_text (legacy). Пропускает наши '
  'DELETE, архивирует чужие (кассир) с stopped_by_* и actor_source=''kds''.';
