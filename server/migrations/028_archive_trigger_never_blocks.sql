-- ============================================================================
-- 028_archive_trigger_never_blocks.sql
--
-- Триггер-архиватор rgst3 больше не может заблокировать снятие стопа
-- в системе заказчика.
--
-- ПРОБЛЕМА. slicer_archive_rgst3_delete() — это BEFORE DELETE триггер на ЧУЖОЙ
-- таблице rgst3_dishstoplist (единственное разрешённое исключение из правила 3).
-- Он вставляет строку в slicer_stop_history, и любая ошибка этой вставки валит
-- всю операцию удаления. То есть кассир жмёт «снять со стопа» в основной KDS,
-- получает ошибку и не может снять стоп — а виноват наш модуль. Причём триггер
-- живёт в базе независимо: наш backend может быть даже не запущен.
--
-- Незакрытых путей было минимум три:
--   1. reason VARCHAR(255) заполнялся из OLD.comment без обрезки — комментарий
--      кассира длиннее 255 символов давал «value too long».
--   2. stopped_at TIMESTAMPTZ NOT NULL заполнялся из OLD.insert_date без
--      подстраховки — NULL нарушал ограничение.
--   3. Функция не SECURITY DEFINER: если основная KDS ходит под отдельной
--      ограниченной ролью, каждый DELETE упирался бы в permission denied на
--      наши slicer_*-таблицы.
--
-- В комментарии к миграции 011 было написано «НЕ блокирует DELETE», но гарантий
-- этого в коде не было.
--
-- РЕШЕНИЕ.
--   * Вся архивация обёрнута в BEGIN ... EXCEPTION WHEN OTHERS THEN ... END:
--     потеря одной строки истории несравнимо дешевле заблокированной работы
--     чужой системы. Причина пишется в WARNING, чтобы пропажу можно было найти.
--   * LEFT(..., 255) на причину и COALESCE(insert_date, NOW()) на время начала.
--   * SECURITY DEFINER — функция выполняется с правами владельца (того, кто
--     прогоняет миграции, т.е. владельца slicer_*-таблиц).
--   * search_path зафиксирован — обязательная гигиена для SECURITY DEFINER.
--
-- Логика определения «наш DELETE» (линковка rgst3_row_suuid + fallback на
-- inserter_text) сохранена из миграции 021 без изменений.
--
-- Идемпотентна: CREATE OR REPLACE FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION slicer_archive_rgst3_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_is_ours     BOOLEAN := FALSE;
  v_inserter    TEXT;
  v_full_name   TEXT;
  v_stopper_uuid UUID;
  v_stopper_name TEXT;
BEGIN
  -- ── Вся работа внутри перехватчика: что бы здесь ни случилось,
  --    DELETE в чужой таблице обязан пройти.
  BEGIN
    -- 1. Наш ли это DELETE? Основной путь — линковка через slicer_dish_stoplist.
    --    rgst3_row_suuid имеет тип UUID (миграция 006) — сравниваем без приведения.
    SELECT EXISTS (
      SELECT 1 FROM slicer_dish_stoplist
       WHERE rgst3_row_suuid = OLD.suuid
    ) INTO v_is_ours;

    -- Fallback (legacy): устаревшее сравнение с настроенным inserter_text.
    -- Срабатывает для orphan-ов, поставленных модулем до миграции 014.
    IF v_is_ours IS NOT TRUE THEN
      SELECT inserter_text INTO v_inserter
        FROM slicer_kds_sync_config
       WHERE id = 1;
      IF v_inserter IS NOT NULL AND OLD.inserter IS NOT NULL AND OLD.inserter = v_inserter THEN
        v_is_ours := TRUE;
      END IF;
    END IF;

    -- Наши строки не архивируем: историю по ним уже написал сам модуль,
    -- иначе в отчёте были бы дубли.
    IF v_is_ours IS TRUE THEN
      RETURN OLD;
    END IF;

    -- 2. Отображаемое имя блюда «<код> <название>»
    SELECT CASE
             WHEN d.code IS NOT NULL AND d.code <> ''
               THEN d.code || ' ' || COALESCE(d.name, 'Unknown dish')
             ELSE COALESCE(d.name, 'Unknown dish')
           END
      INTO v_full_name
      FROM ctlg15_dishes d
     WHERE d.suuid = OLD.rgst3_ctlg15_uuid__dish;

    v_full_name := COALESCE(v_full_name, 'Unknown dish');

    -- 3. Кто поставил стоп: rgst3.inserter — это uuid юзера в виде текста
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

    -- 4. Собственно архивация.
    --    LEFT(...,255) — колонка reason VARCHAR(255), а comment кассира длиной
    --    не ограничен. COALESCE на insert_date — колонка stopped_at NOT NULL.
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
      COALESCE(OLD.insert_date, NOW()),
      NOW(),
      LEFT(NULLIF(OLD.comment, ''), 255),
      GREATEST(0, EXTRACT(EPOCH FROM NOW() - COALESCE(OLD.insert_date, NOW())) * 1000)::BIGINT,
      v_stopper_uuid,
      v_stopper_name,
      'kds'
    );

  EXCEPTION WHEN OTHERS THEN
    -- Архив не важнее работоспособности чужой системы: пишем предупреждение
    -- в лог PostgreSQL и пропускаем DELETE дальше.
    RAISE WARNING 'slicer_archive_rgst3_delete: не удалось заархивировать стоп (%): %',
      SQLSTATE, SQLERRM;
  END;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMENT ON FUNCTION slicer_archive_rgst3_delete() IS
  'Триггер-архиватор (миграции 021 + 028): защита от дубликатов через линковку '
  'slicer_dish_stoplist.rgst3_row_suuid + fallback на config.inserter_text. '
  'Пропускает наши DELETE, архивирует чужие (кассир) с actor_source=''kds''. '
  'С миграции 028 НИКОГДА не блокирует DELETE: вся архивация в EXCEPTION-блоке, '
  'причина обрезается до 255, время подстраховано COALESCE, SECURITY DEFINER '
  'снимает зависимость от прав роли, под которой работает основная KDS.';
