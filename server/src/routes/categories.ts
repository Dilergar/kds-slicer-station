/**
 * Маршруты CRUD для категорий нарезчика (slicer_categories).
 * Категории определяют порядок сортировки на KDS-доске (COURSE_FIFO).
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/** GET /api/categories — Получить все категории, отсортированные по sort_index */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, sort_index FROM slicer_categories ORDER BY sort_index ASC'
    );
    // Маппинг snake_case → camelCase для фронтенда
    const categories = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      sort_index: row.sort_index
    }));
    res.json(categories);
  } catch (err) {
    console.error('[Categories] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения категорий' });
  }
});

/** POST /api/categories — Создать новую категорию */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Название категории обязательно' });
      return;
    }
    // Определяем следующий sort_index (максимальный + 1)
    const maxResult = await pool.query('SELECT COALESCE(MAX(sort_index), -1) + 1 as next_index FROM slicer_categories');
    const nextIndex = maxResult.rows[0].next_index;

    const result = await pool.query(
      'INSERT INTO slicer_categories (name, sort_index) VALUES ($1, $2) RETURNING id, name, sort_index',
      [name, nextIndex]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Categories] Ошибка POST:', err);
    res.status(500).json({ error: 'Ошибка создания категории' });
  }
});

/**
 * PUT /api/categories/reorder — Пакетное обновление порядка sort_index.
 *
 * ВАЖНО: этот маршрут должен быть объявлен ДО `PUT /:id`, иначе Express
 * примет "reorder" за UUID параметра :id и попытается его апдейтнуть,
 * получив `неверный синтаксис для типа uuid: "reorder"`.
 */
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { order } = req.body; // [{id, sort_index}, ...]
    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'Ожидается массив order: [{id, sort_index}]' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        await client.query(
          'UPDATE slicer_categories SET sort_index = $1, updated_at = NOW() WHERE id = $2',
          [item.sort_index, item.id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ reordered: true });
  } catch (err) {
    console.error('[Categories] Ошибка reorder:', err);
    res.status(500).json({ error: 'Ошибка переупорядочивания категорий' });
  }
});

/** PUT /api/categories/:id — Обновить категорию */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sort_index } = req.body;

    const result = await pool.query(
      'UPDATE slicer_categories SET name = COALESCE($1, name), sort_index = COALESCE($2, sort_index), updated_at = NOW() WHERE id = $3 RETURNING id, name, sort_index',
      [name, sort_index, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Категория не найдена' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Categories] Ошибка PUT:', err);
    res.status(500).json({ error: 'Ошибка обновления категории' });
  }
});

/**
 * DELETE /api/categories/:id — Удалить категорию.
 *
 * Отказ 409 если id совпадает с `slicer_settings.dessert_category_id` —
 * эта категория защищена, потому что на неё завязано правило авто-парковки
 * десертов (миграция 017). Чтобы удалить — сначала в админке снять привязку
 * (или выключить тумблер), потом удалять.
 *
 * На уровне БД тоже стоит FK `slicer_settings_dessert_category_fk` с
 * `ON DELETE SET NULL` — защита на случай если кто-то обойдёт нашу проверку
 * и удалит прямым SQL. FK обнулит привязку, правило перестанет срабатывать,
 * constraint не упадёт.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Проверка: не защищённая ли это категория (дессертная).
    const guardRes = await pool.query(
      'SELECT dessert_category_id FROM slicer_settings WHERE id = 1'
    );
    if (guardRes.rows[0]?.dessert_category_id === id) {
      res.status(409).json({
        error: 'Эту категорию нельзя удалить: она настроена как дессертная (авто-парковка). Сначала снимите привязку в настройках.'
      });
      return;
    }

    const result = await pool.query('DELETE FROM slicer_categories WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Категория не найдена' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Categories] Ошибка DELETE:', err);
    res.status(500).json({ error: 'Ошибка удаления категории' });
  }
});

export default router;
