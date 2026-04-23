/**
 * Маршруты для истории заказов и Dashboard аналитики.
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/**
 * GET /api/history/orders — История завершённых заказов.
 * Query params: from, to (ISO date) — фильтрация по дате.
 */
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    let query = 'SELECT * FROM slicer_order_history';
    const params: any[] = [];

    if (from && to) {
      query += ' WHERE completed_at >= $1 AND completed_at <= $2';
      params.push(from, to);
    }
    query += ' ORDER BY completed_at DESC';

    const result = await pool.query(query, params);

    const history = result.rows.map(row => ({
      id: row.id,
      dishId: row.dish_id,
      dishName: row.dish_name,
      completedAt: new Date(row.completed_at).getTime(),
      totalQuantity: row.total_quantity,
      prepTimeMs: Number(row.prep_time_ms),
      was_parked: row.was_parked,
      snapshot: row.snapshot,
      consumedIngredients: row.consumed_ingredients
    }));

    res.json(history);
  } catch (err) {
    console.error('[History] Ошибка orders:', err);
    res.status(500).json({ error: 'Ошибка получения истории заказов' });
  }
});

/** DELETE /api/history/orders/:id — Удалить запись из истории (для restore) */
router.delete('/orders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM slicer_order_history WHERE id = $1 RETURNING id',
      [id]
    );
    // Отличаем успешное удаление от «записи уже не было» — клиенту это важно
    // чтобы не показывать ложный успех при гонках или устаревшем UI.
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Запись истории не найдена' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[History] Ошибка delete:', err);
    res.status(500).json({ error: 'Ошибка удаления записи истории' });
  }
});

/**
 * GET /api/dashboard/speed-kpi — KPI скорости приготовления.
 * Возвращает агрегированные данные по среднему времени из slicer_order_history.
 */
router.get('/dashboard/speed-kpi', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    let query = `
      SELECT dish_id, dish_name, was_parked,
             COUNT(*) as total_cycles,
             SUM(total_quantity) as total_quantity,
             SUM(prep_time_ms) as total_prep_time_ms,
             AVG(prep_time_ms) as avg_prep_time_ms
      FROM slicer_order_history
    `;
    const params: any[] = [];

    if (from && to) {
      query += ' WHERE completed_at >= $1 AND completed_at <= $2';
      params.push(from, to);
    }
    query += ' GROUP BY dish_id, dish_name, was_parked ORDER BY dish_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Dashboard] Ошибка speed-kpi:', err);
    res.status(500).json({ error: 'Ошибка получения KPI' });
  }
});

/**
 * GET /api/dashboard/ingredient-usage — Расход ингредиентов.
 * SQL агрегация из slicer_ingredient_consumption.
 */
router.get('/dashboard/ingredient-usage', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    let query = `
      SELECT c.ingredient_id, c.ingredient_name, c.unit_type,
             SUM(c.quantity) as total_quantity,
             SUM(c.weight_grams) as total_weight_grams
      FROM slicer_ingredient_consumption c
      JOIN slicer_order_history h ON h.id = c.order_history_id
    `;
    const params: any[] = [];

    if (from && to) {
      query += ' WHERE h.completed_at >= $1 AND h.completed_at <= $2';
      params.push(from, to);
    }
    query += ' GROUP BY c.ingredient_id, c.ingredient_name, c.unit_type ORDER BY total_weight_grams DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Dashboard] Ошибка ingredient-usage:', err);
    res.status(500).json({ error: 'Ошибка получения расхода ингредиентов' });
  }
});

/**
 * GET /api/history/dashboard/chef-cooking-speed — «Скорость готовки повара».
 *
 * Возвращает пары (finished_at, docm2tabl1_cooktime) по завершённым нарезчиком
 * позициям. Разница = чистое время работы повара (между сдачей ингредиентов
 * нарезчиком и отметкой готовности на раздаче).
 *
 * Query params: from, to (ISO-даты) — фильтр по finished_at.
 *
 * Возвращает сырые записи — агрегацию по блюдам выполняет фронтенд
 * (аналогично SpeedKpiSection) для единообразия UI и возможности
 * локального поиска/сортировки.
 *
 * Записи, где docm2tabl1_cooktime IS NULL (основная KDS ещё не отметила),
 * или где cooktime <= finished_at (кривые данные / ручная правка задним
 * числом), — отфильтровываются на уровне SQL.
 */
router.get('/dashboard/chef-cooking-speed', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const params: any[] = [];
    let whereExtra = '';

    if (from && to) {
      params.push(from, to);
      whereExtra = ' AND state.finished_at >= $1 AND state.finished_at <= $2';
    }

    // JOIN slicer_order_state → docm2tabl1_items → ctlg15_dishes + резолв алиасов,
    // чтобы разные варианты блюда (163/Д163) аггрегировались на клиенте как одно.
    const query = `
      SELECT
        state.order_item_id AS order_item_id,
        COALESCE(alias.primary_dish_id::uuid, items.docm2tabl1_ctlg15_uuid__dish) AS dish_id,
        COALESCE(primary_dish.name, dishes.name) AS dish_name,
        items.docm2tabl1_quantity AS quantity,
        state.finished_at AS finished_at,
        items.docm2tabl1_cooktime AS cooktime,
        EXTRACT(EPOCH FROM items.docm2tabl1_cooktime - state.finished_at) * 1000 AS cook_time_ms
      FROM slicer_order_state state
      JOIN docm2tabl1_items items ON items.suuid::text = state.order_item_id
      JOIN ctlg15_dishes dishes ON dishes.suuid = items.docm2tabl1_ctlg15_uuid__dish
      LEFT JOIN slicer_dish_aliases alias
        ON alias.alias_dish_id = items.docm2tabl1_ctlg15_uuid__dish::text
      LEFT JOIN ctlg15_dishes primary_dish
        ON primary_dish.suuid::text = alias.primary_dish_id
      WHERE state.finished_at IS NOT NULL
        AND items.docm2tabl1_cooktime IS NOT NULL
        AND items.docm2tabl1_cooktime > state.finished_at
        ${whereExtra}
      ORDER BY state.finished_at DESC
    `;

    const result = await pool.query(query, params);

    const entries = result.rows.map(row => ({
      orderItemId: row.order_item_id,
      dishId: row.dish_id,
      dishName: row.dish_name,
      quantity: Number(row.quantity) || 1,
      finishedAt: new Date(row.finished_at).getTime(),
      cookTimeMs: Math.round(Number(row.cook_time_ms))
    }));

    res.json(entries);
  } catch (err) {
    console.error('[Dashboard] Ошибка chef-cooking-speed:', err);
    res.status(500).json({ error: 'Ошибка получения данных о скорости готовки повара' });
  }
});

export default router;
