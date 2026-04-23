/**
 * Маршруты CRUD для рецептов (slicer_recipes).
 * Рецепт = связь блюда (ctlg15_dishes.suuid) с ингредиентами (slicer_ingredients)
 * и количеством на порцию.
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/** GET /api/recipes/:dishId — Получить ингредиенты рецепта для конкретного блюда */
router.get('/:dishId', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const result = await pool.query(
      `SELECT r.id, r.ingredient_id, r.quantity_per_portion,
              i.name AS ingredient_name, i.unit_type, i.piece_weight_grams, i.image_url
       FROM slicer_recipes r
       JOIN slicer_ingredients i ON i.id = r.ingredient_id
       WHERE r.dish_id = $1
       ORDER BY i.name`,
      [dishId]
    );
    const ingredients = result.rows.map(row => ({
      id: row.ingredient_id,
      quantity: Number(row.quantity_per_portion),
      name: row.ingredient_name,
      unitType: row.unit_type,
      pieceWeightGrams: row.piece_weight_grams ? Number(row.piece_weight_grams) : undefined,
      imageUrl: row.image_url || undefined
    }));
    res.json(ingredients);
  } catch (err) {
    console.error('[Recipes] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения рецепта' });
  }
});

/**
 * PUT /api/recipes/:dishId — Установить/заменить ингредиенты рецепта.
 * Body: { ingredients: [{ ingredientId, quantity }] }
 * Удаляет старые записи и вставляет новые (полная замена).
 */
router.put('/:dishId', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const { ingredients } = req.body;

    if (!Array.isArray(ingredients)) {
      res.status(400).json({ error: 'Ожидается массив ingredients: [{ingredientId, quantity}]' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем старые ингредиенты рецепта
      await client.query('DELETE FROM slicer_recipes WHERE dish_id = $1', [dishId]);

      // Вставляем новые
      for (const ing of ingredients) {
        await client.query(
          'INSERT INTO slicer_recipes (dish_id, ingredient_id, quantity_per_portion) VALUES ($1, $2, $3)',
          [dishId, ing.ingredientId, ing.quantity]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ updated: true });
  } catch (err) {
    console.error('[Recipes] Ошибка PUT:', err);
    res.status(500).json({ error: 'Ошибка обновления рецепта' });
  }
});

export default router;
