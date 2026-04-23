-- ============================================================================
-- Миграция 014: Отслеживание актора стопов (кто поставил / кто снял)
-- Дата: 2026-04-23
--
-- Цель:
--   Записывать в slicer_stop_history пары (stopped_by_uuid, stopped_by_name)
--   и (resumed_by_uuid, resumed_by_name) — чтобы в UI и отчётах было видно,
--   КТО именно поставил стоп и кто его снял.
--
-- Источники актора:
--   1. slicer (наш модуль)  — из авторизации по PIN (users.uuid + users.login)
--   2. kds (основная KDS)   — чужая rgst3_dishstoplist пишет свой inserter
--      (UUID юзера как text), триггер резолвит его через users
--   3. cascade              — каскадный стоп блюда от стопнутого ингредиента,
--      наследует актора от родительского toggle ингредиента
--
-- Почему кэшируем имя (stopped_by_name) отдельно от uuid:
--   - Один SELECT к users при записи, потом JOIN'ить не надо
--   - Если юзера удалят или переименуют — в истории остаётся имя на момент
--     действия. Это правильная аудит-семантика.
--
-- Что делаем со старыми записями:
--   Вариант A (согласовано с заказчиком): НЕ ретро-заполняем. Для старых
--   stop-history все actor_* останутся NULL, UI покажет «—». Тут нет способа
--   достоверно узнать кто поставил стоп задним числом (rgst3 мог уже удалить
--   row или кассир сменился).
-- ============================================================================

-- --- slicer_stop_history: добавляем actor_* ----------------------------------
ALTER TABLE slicer_stop_history
  ADD COLUMN IF NOT EXISTS stopped_by_uuid UUID,
  ADD COLUMN IF NOT EXISTS stopped_by_name TEXT,
  ADD COLUMN IF NOT EXISTS resumed_by_uuid UUID,
  ADD COLUMN IF NOT EXISTS resumed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS actor_source TEXT;

COMMENT ON COLUMN slicer_stop_history.stopped_by_uuid IS
  'UUID пользователя, поставившего стоп. Для slicer — users.uuid залогиненного '
  'по PIN. Для kds — OLD.inserter из rgst3_dishstoplist (тоже users.uuid). '
  'NULL для записей до миграции 014.';

COMMENT ON COLUMN slicer_stop_history.stopped_by_name IS
  'Кэшированное ФИО из users.login на момент стопа. Не обновляется при '
  'переименовании юзера — для честного аудита.';

COMMENT ON COLUMN slicer_stop_history.resumed_by_uuid IS
  'UUID пользователя, снявшего стоп. NULL если стоп ещё активен, или если '
  'снятие инициировано из основной KDS (rgst3 не пишет кто именно сделал '
  'DELETE — только кто был последним updater, что не всегда = сняший).';

COMMENT ON COLUMN slicer_stop_history.resumed_by_name IS
  'Кэшированное ФИО того кто снял. См. resumed_by_uuid.';

COMMENT ON COLUMN slicer_stop_history.actor_source IS
  '''slicer'' | ''kds'' | ''cascade'' — откуда пришло действие постановки стопа. '
  'Для фильтрации в Dashboard и отличия автоматических каскадов от ручных.';


-- --- slicer_dish_stoplist: кто поставил MANUAL/CASCADE ------------------------
-- Нужно чтобы при снятии стопа заполнить resumed_by_* и не потерять
-- stopped_by_* (они известны только в момент постановки).
ALTER TABLE slicer_dish_stoplist
  ADD COLUMN IF NOT EXISTS stopped_by_uuid UUID,
  ADD COLUMN IF NOT EXISTS stopped_by_name TEXT,
  ADD COLUMN IF NOT EXISTS actor_source TEXT;

COMMENT ON COLUMN slicer_dish_stoplist.stopped_by_uuid IS
  'UUID пользователя, поставившего блюдо на стоп. При MANUAL — из авторизации, '
  'при CASCADE — наследуется от actor ингредиента, который вызвал каскад.';

COMMENT ON COLUMN slicer_dish_stoplist.actor_source IS
  'Источник действия: slicer / kds / cascade. Копируется в slicer_stop_history '
  'при удалении строки (снятие стопа).';


-- --- slicer_ingredients: кто поставил is_stopped=true -------------------------
-- Аналогично: чтобы при снятии стопа (is_stopped → false) мы могли:
--   а) записать в историю stopped_by_* (из текущих полей)
--   б) и resumed_by_* (из авторизации снимающего)
ALTER TABLE slicer_ingredients
  ADD COLUMN IF NOT EXISTS stopped_by_uuid UUID,
  ADD COLUMN IF NOT EXISTS stopped_by_name TEXT;

COMMENT ON COLUMN slicer_ingredients.stopped_by_uuid IS
  'UUID пользователя, поставившего ингредиент на стоп. NULL когда is_stopped=false. '
  'Очищается вместе с stop_reason/stop_timestamp при снятии.';

COMMENT ON COLUMN slicer_ingredients.stopped_by_name IS
  'Кэшированное ФИО. См. stopped_by_uuid.';

-- Индекс опционален — стопы в ingredients редки, фильтров по актору нет
