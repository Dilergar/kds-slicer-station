-- ─────────────────────────────────────────────────────────────────────────────
-- Скрипт авто-конфигурации двусторонней синхронизации стоп-листа.
--
-- Заполняет slicer_kds_sync_config значениями, авто-определёнными из БД:
--   • restaurant_id — единственный ctlg11_restaurants.suuid (если их > 1, fail)
--   • menu_id       — единственное ctlg16_restaurantmenu.suuid этого ресторана
--   • responsible_user_id — fallback: первый служебный ctlg5_employees.suuid
--                          (используется только если actor не передан в API).
--                          В норме responsible пишется per-user из PIN-сессии.
--   • inserter_text — оставляем default 'slicer-module' (тоже fallback).
--
-- Идемпотентен: ON CONFLICT DO UPDATE. Можно запускать повторно.
--
-- ИСПОЛЬЗОВАНИЕ:
--   psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/scripts/configure-kds-sync.sql
--
-- Если в БД заказчика > 1 ресторана или > 1 меню, скрипт упадёт с ошибкой —
-- в этом случае нужно заполнить slicer_kds_sync_config вручную (см.
-- Инструкция.md → раздел «Двусторонняя синхронизация стоп-листа»).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_restaurant_count  INTEGER;
  v_restaurant_id     UUID;
  v_menu_count        INTEGER;
  v_menu_id           UUID;
  v_responsible_id    UUID;
BEGIN
  -- 1. Ресторан
  SELECT COUNT(*) INTO v_restaurant_count FROM ctlg11_restaurants;
  IF v_restaurant_count = 0 THEN
    RAISE EXCEPTION 'Авто-конфигурация невозможна: в ctlg11_restaurants нет ни одной записи.';
  ELSIF v_restaurant_count > 1 THEN
    RAISE EXCEPTION 'Авто-конфигурация невозможна: в ctlg11_restaurants найдено % ресторанов. '
      'Заполните slicer_kds_sync_config вручную, выбрав нужный.', v_restaurant_count;
  END IF;
  SELECT suuid INTO v_restaurant_id FROM ctlg11_restaurants LIMIT 1;

  -- 2. Меню (только для выбранного ресторана)
  SELECT COUNT(*) INTO v_menu_count
    FROM ctlg16_restaurantmenu
   WHERE ctlg16_ctlg11_uuid__restaurant = v_restaurant_id;
  IF v_menu_count = 0 THEN
    RAISE EXCEPTION 'Авто-конфигурация невозможна: для ресторана % нет ни одного меню в ctlg16_restaurantmenu.',
      v_restaurant_id;
  ELSIF v_menu_count > 1 THEN
    RAISE EXCEPTION 'Авто-конфигурация невозможна: для ресторана % найдено % активных меню. '
      'Заполните slicer_kds_sync_config вручную.', v_restaurant_id, v_menu_count;
  END IF;
  SELECT suuid INTO v_menu_id
    FROM ctlg16_restaurantmenu
   WHERE ctlg16_ctlg11_uuid__restaurant = v_restaurant_id
   LIMIT 1;

  -- 3. Responsible fallback. Берём первого живого employee, привязанного к
  --    активному (locked=false) PIN-юзеру. Если таких нет — любого живого.
  --    В норме это поле почти не используется: реального responsible подставляет
  --    pushDishStop() из actor.uuid → ctlg10_useremployees → ctlg5_employees.suuid.
  SELECT e.suuid INTO v_responsible_id
    FROM ctlg5_employees e
    JOIN ctlg10_useremployees ue ON ue.ctlg10_ctlg5_uuid__employee = e.suuid
    JOIN users u ON u.uuid = ue.ctlg10_user
   WHERE e.ctlg5_dismissed = false
     AND u.locked = false
   ORDER BY e.name
   LIMIT 1;
  IF v_responsible_id IS NULL THEN
    SELECT suuid INTO v_responsible_id
      FROM ctlg5_employees
     WHERE ctlg5_dismissed = false
     ORDER BY name
     LIMIT 1;
  END IF;
  IF v_responsible_id IS NULL THEN
    RAISE EXCEPTION 'Авто-конфигурация невозможна: в ctlg5_employees нет ни одного активного сотрудника для fallback responsible.';
  END IF;

  -- 4. UPSERT в singleton-конфиг.
  INSERT INTO slicer_kds_sync_config (id, restaurant_id, menu_id, responsible_user_id, updated_at)
  VALUES (1, v_restaurant_id, v_menu_id, v_responsible_id, NOW())
  ON CONFLICT (id) DO UPDATE SET
    restaurant_id       = EXCLUDED.restaurant_id,
    menu_id             = EXCLUDED.menu_id,
    responsible_user_id = EXCLUDED.responsible_user_id,
    updated_at          = NOW();

  RAISE NOTICE 'slicer_kds_sync_config заполнен: restaurant=%, menu=%, responsible_fallback=%',
    v_restaurant_id, v_menu_id, v_responsible_id;
END $$;
