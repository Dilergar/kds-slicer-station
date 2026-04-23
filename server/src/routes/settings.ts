/**
 * Маршруты для настроек модуля нарезчика (slicer_settings).
 * Таблица singleton — всегда одна строка с id=1.
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/** GET /api/settings — Получить все настройки */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM slicer_settings WHERE id = 1');
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Настройки не найдены' });
      return;
    }
    const row = result.rows[0];
    // Маппинг snake_case → camelCase для совместимости с типом SystemSettings
    res.json({
      aggregationWindowMinutes: row.aggregation_window_minutes,
      historyRetentionMinutes: row.history_retention_minutes,
      activePriorityRules: row.active_priority_rules,
      courseWindowSeconds: row.course_window_seconds,
      restaurantOpenTime: row.restaurant_open_time,
      restaurantCloseTime: row.restaurant_close_time,
      excludedDates: row.excluded_dates,
      enableAggregation: row.enable_aggregation,
      enableSmartAggregation: row.enable_smart_aggregation,
      enableKdsStoplistSync: row.enable_kds_stoplist_sync,
      // Разморозка (миграция 016): глобальное время в минутах + toggle звука
      // на истечение таймера. Оба поля singleton-настройки.
      defrostDurationMinutes: row.defrost_duration_minutes,
      enableDefrostSound: row.enable_defrost_sound,
      // Авто-парковка десертов (миграция 017)
      dessertCategoryId: row.dessert_category_id,
      dessertAutoParkEnabled: row.dessert_auto_park_enabled,
      dessertAutoParkMinutes: row.dessert_auto_park_minutes
    });
  } catch (err) {
    console.error('[Settings] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

/** PUT /api/settings — Обновить настройки */
router.put('/', async (req: Request, res: Response) => {
  try {
    const {
      aggregationWindowMinutes,
      historyRetentionMinutes,
      activePriorityRules,
      courseWindowSeconds,
      restaurantOpenTime,
      restaurantCloseTime,
      excludedDates,
      enableAggregation,
      enableSmartAggregation,
      enableKdsStoplistSync,
      defrostDurationMinutes,
      enableDefrostSound,
      dessertCategoryId,
      dessertAutoParkEnabled,
      dessertAutoParkMinutes
    } = req.body;

    // Валидация defrostDurationMinutes: CHECK в БД (1..60) всё равно упадёт,
    // но вернём 400 заранее с понятным текстом, чтобы не ловить 500.
    if (
      defrostDurationMinutes != null &&
      (typeof defrostDurationMinutes !== 'number' ||
        defrostDurationMinutes < 1 ||
        defrostDurationMinutes > 60)
    ) {
      res.status(400).json({ error: 'defrostDurationMinutes должен быть целым числом 1..60' });
      return;
    }

    // Валидация dessertAutoParkMinutes (симметрично — CHECK БД 1..240).
    if (
      dessertAutoParkMinutes != null &&
      (typeof dessertAutoParkMinutes !== 'number' ||
        dessertAutoParkMinutes < 1 ||
        dessertAutoParkMinutes > 240)
    ) {
      res.status(400).json({ error: 'dessertAutoParkMinutes должен быть целым числом 1..240' });
      return;
    }

    const result = await pool.query(
      `UPDATE slicer_settings SET
        aggregation_window_minutes = COALESCE($1, aggregation_window_minutes),
        history_retention_minutes = COALESCE($2, history_retention_minutes),
        active_priority_rules = COALESCE($3, active_priority_rules),
        course_window_seconds = COALESCE($4, course_window_seconds),
        restaurant_open_time = COALESCE($5, restaurant_open_time),
        restaurant_close_time = COALESCE($6, restaurant_close_time),
        excluded_dates = COALESCE($7, excluded_dates),
        enable_aggregation = COALESCE($8, enable_aggregation),
        enable_smart_aggregation = COALESCE($9, enable_smart_aggregation),
        enable_kds_stoplist_sync = COALESCE($10, enable_kds_stoplist_sync),
        defrost_duration_minutes = COALESCE($11, defrost_duration_minutes),
        enable_defrost_sound = COALESCE($12, enable_defrost_sound),
        -- Десерты: dessert_category_id может прийти явным null (отвязать),
        -- поэтому НЕ через COALESCE — используем флаг $16 "трогаем ли это поле".
        dessert_category_id = CASE WHEN $16::bool THEN $13::uuid ELSE dessert_category_id END,
        dessert_auto_park_enabled = COALESCE($14, dessert_auto_park_enabled),
        dessert_auto_park_minutes = COALESCE($15, dessert_auto_park_minutes),
        updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        aggregationWindowMinutes,
        historyRetentionMinutes,
        activePriorityRules ? JSON.stringify(activePriorityRules) : null,
        courseWindowSeconds,
        restaurantOpenTime,
        restaurantCloseTime,
        excludedDates ? JSON.stringify(excludedDates) : null,
        enableAggregation,
        enableSmartAggregation,
        enableKdsStoplistSync,
        defrostDurationMinutes,
        enableDefrostSound,
        dessertCategoryId ?? null,
        dessertAutoParkEnabled,
        dessertAutoParkMinutes,
        // Флаг: клиент явно прислал поле dessertCategoryId (в т.ч. null) —
        // значит хочет его изменить. Отсутствие ключа в body → не трогаем.
        Object.prototype.hasOwnProperty.call(req.body, 'dessertCategoryId')
      ]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Настройки не найдены' });
      return;
    }
    const row = result.rows[0];
    res.json({
      aggregationWindowMinutes: row.aggregation_window_minutes,
      historyRetentionMinutes: row.history_retention_minutes,
      activePriorityRules: row.active_priority_rules,
      courseWindowSeconds: row.course_window_seconds,
      restaurantOpenTime: row.restaurant_open_time,
      restaurantCloseTime: row.restaurant_close_time,
      excludedDates: row.excluded_dates,
      enableAggregation: row.enable_aggregation,
      enableSmartAggregation: row.enable_smart_aggregation,
      enableKdsStoplistSync: row.enable_kds_stoplist_sync,
      defrostDurationMinutes: row.defrost_duration_minutes,
      enableDefrostSound: row.enable_defrost_sound,
      dessertCategoryId: row.dessert_category_id,
      dessertAutoParkEnabled: row.dessert_auto_park_enabled,
      dessertAutoParkMinutes: row.dessert_auto_park_minutes
    });
  } catch (err) {
    console.error('[Settings] Ошибка PUT:', err);
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

export default router;
