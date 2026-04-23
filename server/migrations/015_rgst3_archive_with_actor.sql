-- ============================================================================
-- Миграция 015: триггер slicer_archive_rgst3_delete пишет stopped_by_*
-- Дата: 2026-04-23
--
-- Дополнение к миграции 014.
--
-- Что меняем:
--   Триггер архивации rgst3-стопов теперь резолвит OLD.inserter (UUID юзера
--   как text) в users.login и пишет stopped_by_uuid + stopped_by_name +
--   actor_source='kds' в slicer_stop_history.
--
-- Что НЕ меняем:
--   resumed_by_* остаются NULL для kds-архивированных записей. Почему:
--   - rgst3_dishstoplist не пишет «кто удалил row». OLD.updater часто равен
--     OLD.inserter (основная KDS не обновляет стоп-лист между insert и
--     delete), т.е. из него нельзя достоверно вытащить «сняшего».
--   - Если когда-нибудь основная KDS начнёт обновлять updater перед DELETE —
--     добавим резолв и сюда. Пока UI покажет «—» в колонке «Снял» для
--     kds-стопов.
-- ============================================================================

CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete() RETURNS trigger AS $$
DECLARE
  v_dish_code TEXT;
  v_dish_name TEXT;
  v_full_name TEXT;
  v_our_inserter TEXT;
  v_stopper_uuid UUID;
  v_stopper_name TEXT;
BEGIN
  -- Защита от дубликатов при двусторонней синхронизации — как в миграциях 011/012.
  SELECT inserter_text INTO v_our_inserter
    FROM slicer_kds_sync_config
    WHERE id = 1;

  IF v_our_inserter IS NOT NULL
     AND OLD.inserter IS NOT NULL
     AND OLD.inserter = v_our_inserter
  THEN
    RETURN OLD;
  END IF;

  -- Имя блюда + код (формат "<code> <name>") — как в миграции 012.
  SELECT code, name INTO v_dish_code, v_dish_name
    FROM ctlg15_dishes
    WHERE suuid = OLD.rgst3_ctlg15_uuid__dish;

  IF v_dish_code IS NOT NULL AND v_dish_code <> '' THEN
    v_full_name := v_dish_code || ' ' || COALESCE(v_dish_name, 'Unknown dish');
  ELSE
    v_full_name := COALESCE(v_dish_name, 'Unknown dish');
  END IF;

  -- Резолв актора: OLD.inserter хранится как TEXT, но по факту содержит UUID
  -- пользователя. Пытаемся найти в users. Если не нашли (бывает когда основная
  -- KDS писала другой UUID, не совпадающий с users.uuid — напр. из internal
  -- сервисного аккаунта) — пишем сырой UUID-текст в name, uuid оставляем NULL.
  BEGIN
    SELECT u.uuid, TRIM(u.login)
      INTO v_stopper_uuid, v_stopper_name
      FROM users u
      WHERE u.uuid::text = OLD.inserter;
  EXCEPTION WHEN invalid_text_representation THEN
    -- OLD.inserter не UUID (исторические данные?) — не падаем, просто NULL
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
    -- resumed_by_* намеренно NULL: см. шапку миграции
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
  'Триггер-архиватор (миграция 015): при DELETE из rgst3_dishstoplist пишет '
  'запись в slicer_stop_history с stopped_by_* (из users по OLD.inserter) '
  'и actor_source=''kds''. resumed_by_* остаются NULL — rgst3 не хранит '
  'кто именно сделал DELETE.';
