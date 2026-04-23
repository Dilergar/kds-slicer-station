-- ============================================================================
-- Миграция 018: Вариант Б парковки — разделение «ручная» vs «авто»
-- Дата: 2026-04-23
--
-- Меняем СЕМАНТИКУ accumulated_time_ms:
--   Было:   «активное время ДО парковки» (складывалось при park)
--   Стало:  «общее время парковок» (складывается при unpark)
--
-- Новая формула таймера на клиенте:
--   pivot    = order.status === 'PARKED' ? parked_at : now
--   elapsed  = (pivot - created_at) - accumulated_time_ms
--
-- Правила по источнику парковки:
--   * Ручная парковка нарезчиком /park:
--       parked_by_auto = FALSE
--       При unpark: accumulated_time_ms += (NOW() - parked_at)
--       effective_created_at не трогаем → сортировка остаётся по ordertime,
--       заказ возвращается на своё историческое место в очереди.
--
--   * Авто-парковка десертов (в GET /api/orders):
--       parked_by_auto = TRUE, parked_at = ordertime, unpark_at = ordertime + X min
--       При авто-разпарковке (в GET, unpark_at <= NOW()):
--         accumulated_time_ms = 0
--         effective_created_at = unpark_at → сортировка как «новый заказ»,
--         десерт встаёт в конец очереди.
--
--   * Ручной unpark автопаркованного десерта (редкий кейс: гость сказал «несите уже»):
--       Считаем как «новый заказ для кухни»:
--         accumulated_time_ms = 0
--         effective_created_at = NOW()
--
-- Что добавляется:
--   1) slicer_order_state.effective_created_at TIMESTAMPTZ NULL
--      Если NOT NULL → используется вместо ordertime как точка отсчёта таймера
--      и ключ сортировки COURSE_FIFO. Для новых (никогда не паркованных) — NULL
--      и COALESCE фолбэчит на docm2tabl1_ordertime.
--
--   2) slicer_order_state.parked_by_auto BOOLEAN DEFAULT FALSE
--      Помечает АКТИВНУЮ парковку как авто. После unpark сбрасывается в FALSE
--      (флаг актуален только пока status='PARKED').
-- ============================================================================

ALTER TABLE slicer_order_state
  ADD COLUMN IF NOT EXISTS effective_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS parked_by_auto       BOOLEAN     NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN slicer_order_state.effective_created_at IS
  'Переопределение "когда заказ попал в очередь нарезчика" для сортировки и '
  'таймера. NULL = используем docm2tabl1_ordertime (новый заказ). Устанавливается '
  'только при авто-разпарковке десерта (= unpark_at) или при ручном unpark '
  'авто-припаркованной позиции (= NOW()). Ручная парковка/разпарковка не трогают.';

COMMENT ON COLUMN slicer_order_state.parked_by_auto IS
  'Флаг: текущая парковка была автоматической (правило автопарковки десертов, '
  'миграция 017). Используется в /unpark endpoint и auto-unpark блоке GET /orders '
  'чтобы применить правильную логику обновления accumulated_time_ms и '
  'effective_created_at. Сбрасывается в FALSE при разпарковке.';
