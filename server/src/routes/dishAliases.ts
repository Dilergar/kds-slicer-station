/**
 * Маршруты для управления алиасами блюд (slicer_dish_aliases).
 *
 * Алиас — это механизм "одно блюдо использует рецепт другого".
 * Используется для вариантов (например "Д163 Баклажаны" → "163 Баклажаны"),
 * где разные позиции меню в кассе представляют одно и то же блюдо для нарезчика.
 *
 * Ограничение: alias_dish_id — PRIMARY KEY, то есть одно блюдо может быть
 * алиасом только одного primary (одно блюдо = один рецепт).
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/**
 * GET /api/dish-aliases — Получить список всех алиасов.
 * Используется фронтом для построения map (aliasId → primaryId) и UI.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT alias_dish_id, primary_dish_id, created_at FROM slicer_dish_aliases ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[DishAliases] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения алиасов блюд' });
  }
});

/**
 * POST /api/dish-aliases — Создать или обновить алиас.
 * Body: { alias_dish_id, primary_dish_id }
 *
 * UPSERT: если блюдо уже было алиасом другого primary — просто переназначит.
 * Защита от self-alias: нельзя сделать блюдо алиасом самого себя.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { alias_dish_id, primary_dish_id } = req.body;

    if (!alias_dish_id || !primary_dish_id) {
      res.status(400).json({ error: 'alias_dish_id и primary_dish_id обязательны' });
      return;
    }

    if (alias_dish_id === primary_dish_id) {
      res.status(400).json({ error: 'Блюдо не может быть алиасом самого себя' });
      return;
    }

    // Создаём алиас и синхронизируем категории алиаса с primary в одной
    // транзакции. Зачем: при связывании alias-блюдо должно получить те же
    // slicer-категории, что и primary — иначе alias продолжает болтаться
    // в «Без категории», что ломает сортировку очереди.
    const client = await pool.connect();
    let aliasRow;
    try {
      await client.query('BEGIN');

      // UPSERT алиаса
      const aliasResult = await client.query(
        `INSERT INTO slicer_dish_aliases (alias_dish_id, primary_dish_id)
         VALUES ($1, $2)
         ON CONFLICT (alias_dish_id) DO UPDATE SET primary_dish_id = EXCLUDED.primary_dish_id
         RETURNING alias_dish_id, primary_dish_id, created_at`,
        [alias_dish_id, primary_dish_id]
      );
      aliasRow = aliasResult.rows[0];

      // Копируем категории primary → alias: сначала чистим старые
      // назначения alias, затем инсертим те же category_id что у primary.
      await client.query(
        'DELETE FROM slicer_dish_categories WHERE dish_id = $1',
        [alias_dish_id]
      );
      await client.query(
        `INSERT INTO slicer_dish_categories (dish_id, category_id)
         SELECT $1, category_id FROM slicer_dish_categories WHERE dish_id = $2
         ON CONFLICT DO NOTHING`,
        [alias_dish_id, primary_dish_id]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json(aliasRow);
  } catch (err) {
    console.error('[DishAliases] Ошибка POST:', err);
    res.status(500).json({ error: 'Ошибка создания алиаса' });
  }
});

/**
 * DELETE /api/dish-aliases/:alias_dish_id — Удалить алиас.
 * После удаления блюдо снова становится independent (использует свой собственный рецепт).
 */
router.delete('/:alias_dish_id', async (req: Request, res: Response) => {
  try {
    const { alias_dish_id } = req.params;
    const result = await pool.query(
      'DELETE FROM slicer_dish_aliases WHERE alias_dish_id = $1 RETURNING alias_dish_id',
      [alias_dish_id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Алиас не найден' });
      return;
    }
    res.json({ unlinked: true });
  } catch (err) {
    console.error('[DishAliases] Ошибка DELETE:', err);
    res.status(500).json({ error: 'Ошибка удаления алиаса' });
  }
});

export default router;
