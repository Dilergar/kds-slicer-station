/**
 * Маршруты CRUD для ингредиентов нарезчика (slicer_ingredients).
 * Поддерживает двухуровневую иерархию: Родитель → Разновидность (parent_id).
 * Стоп-лист хранится прямо в этой таблице (is_stopped, stop_reason, stop_timestamp).
 *
 * Фото ингредиента: с миграции 009 хранится как путь в image_url
 * (/images/ingredients/<id>.<ext>), сам файл лежит на диске в
 * server/public/images/ingredients/. Upload через multer, endpoints
 * POST /:id/image и DELETE /:id/image — по аналогии с slicer_dish_images
 * (см. routes/dishes.ts).
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../config/db';

const router = Router();

/** UUID v4-формат — `slicer_ingredients.id` всегда UUID. См. dishes.ts для пояснения. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware: блокирует запрос если :id не UUID. Должен идти ПЕРЕД multer-ом
 * чтобы предотвратить запись опасного имени файла на диск.
 */
function validateIngredientUuid(req: Request, res: Response, next: NextFunction): void {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Некорректный id ингредиента (ожидается UUID)' });
    return;
  }
  next();
}

/** Гарантирует что путь file находится внутри baseDir. См. dishes.ts. */
function isPathInside(filePath: string, baseDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep);
}

/**
 * Папка для загруженных фото ингредиентов.
 * Создаётся при старте модуля если её нет.
 * __dirname в dev: server/src/routes, в prod: server/dist/routes — ../../public даёт server/public в обоих случаях.
 */
const UPLOAD_DIR_ING = path.resolve(__dirname, '../../public/images/ingredients');
if (!fs.existsSync(UPLOAD_DIR_ING)) fs.mkdirSync(UPLOAD_DIR_ING, { recursive: true });

const ingredientUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_ING),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${req.params.id}${ext}`);
  }
});

const uploadIngredientImage = multer({
  storage: ingredientUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Неподдерживаемый формат файла (только JPEG/PNG/GIF/WEBP)'));
  }
});

/** GET /api/ingredients — Получить все ингредиенты (с иерархией) */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, parent_id, image_url, unit_type, piece_weight_grams, buffer_percent, is_stopped, stop_reason, stop_timestamp FROM slicer_ingredients ORDER BY parent_id NULLS FIRST, name'
    );
    // Маппинг snake_case → camelCase для совместимости с типом IngredientBase
    const ingredients = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id || undefined,
      imageUrl: row.image_url || undefined,
      unitType: row.unit_type,
      pieceWeightGrams: row.piece_weight_grams ? Number(row.piece_weight_grams) : undefined,
      bufferPercent: Number(row.buffer_percent) || 0,
      is_stopped: row.is_stopped,
      stop_reason: row.stop_reason || undefined,
      stop_timestamp: row.stop_timestamp ? new Date(row.stop_timestamp).getTime() : undefined
    }));
    res.json(ingredients);
  } catch (err) {
    console.error('[Ingredients] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения ингредиентов' });
  }
});

/** POST /api/ingredients — Создать новый ингредиент */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, parentId, imageUrl, unitType, pieceWeightGrams } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Название ингредиента обязательно' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO slicer_ingredients (name, parent_id, image_url, unit_type, piece_weight_grams)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, parent_id, image_url, unit_type, piece_weight_grams, is_stopped`,
      [name, parentId || null, imageUrl || null, unitType || 'kg', pieceWeightGrams || null]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      name: row.name,
      parentId: row.parent_id || undefined,
      imageUrl: row.image_url || undefined,
      unitType: row.unit_type,
      pieceWeightGrams: row.piece_weight_grams ? Number(row.piece_weight_grams) : undefined,
      is_stopped: row.is_stopped
    });
  } catch (err) {
    console.error('[Ingredients] Ошибка POST:', err);
    res.status(500).json({ error: 'Ошибка создания ингредиента' });
  }
});

/**
 * PUT /api/ingredients/:id — Частичное обновление ингредиента (PATCH-семантика).
 *
 * Обновляем ТОЛЬКО те поля, которые реально пришли в body. Если поле не
 * передано (undefined) — не трогаем его в БД. Если передано как null —
 * обнуляем (актуально для parent_id: явный null = «отвязать от родителя»).
 *
 * Старая реализация всегда ставила `parent_id = $2 ?? null`, что при
 * частичном апдейте (например `{ imageUrl: '...' }`) молча отрывало
 * ребёнка от родителя. Это давало эффект «фото добавил — ингредиент
 * стал самостоятельным».
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as {
      name?: string;
      parentId?: string | null;
      imageUrl?: string | null;
      unitType?: 'kg' | 'piece';
      pieceWeightGrams?: number | null;
      bufferPercent?: number;
    };

    // Маппинг поля-фронта → колонка-БД
    const fieldMap: Array<[keyof typeof body, string]> = [
      ['name',              'name'],
      ['parentId',          'parent_id'],
      ['imageUrl',          'image_url'],
      ['unitType',          'unit_type'],
      ['pieceWeightGrams',  'piece_weight_grams'],
      ['bufferPercent',     'buffer_percent'],
    ];

    // Собираем SET и параметры только из пришедших полей.
    // hasOwnProperty — потому что null должен проходить (валидное значение
    // для parent_id/imageUrl/pieceWeightGrams), а вот undefined = «не было
    // в JSON» → пропускаем.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const [bodyKey, column] of fieldMap) {
      if (Object.prototype.hasOwnProperty.call(body, bodyKey)) {
        values.push(body[bodyKey]);
        setClauses.push(`${column} = $${values.length}`);
      }
    }

    if (setClauses.length === 0) {
      // Пустой PUT — ничего не меняем, просто возвращаем текущее состояние.
      const cur = await pool.query(
        `SELECT id, name, parent_id, image_url, unit_type, piece_weight_grams, is_stopped, stop_reason, stop_timestamp
           FROM slicer_ingredients WHERE id = $1`,
        [id]
      );
      if (cur.rows.length === 0) { res.status(404).json({ error: 'Ингредиент не найден' }); return; }
      const row = cur.rows[0];
      res.json({
        id: row.id, name: row.name, parentId: row.parent_id || undefined,
        imageUrl: row.image_url || undefined, unitType: row.unit_type,
        pieceWeightGrams: row.piece_weight_grams ? Number(row.piece_weight_grams) : undefined,
        is_stopped: row.is_stopped, stop_reason: row.stop_reason || undefined,
        stop_timestamp: row.stop_timestamp ? new Date(row.stop_timestamp).getTime() : undefined
      });
      return;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const idParam = `$${values.length}`;

    const result = await pool.query(
      `UPDATE slicer_ingredients SET ${setClauses.join(', ')}
        WHERE id = ${idParam}
        RETURNING id, name, parent_id, image_url, unit_type, piece_weight_grams, buffer_percent, is_stopped, stop_reason, stop_timestamp`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ингредиент не найден' });
      return;
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      parentId: row.parent_id || undefined,
      imageUrl: row.image_url || undefined,
      unitType: row.unit_type,
      pieceWeightGrams: row.piece_weight_grams ? Number(row.piece_weight_grams) : undefined,
      bufferPercent: Number(row.buffer_percent) || 0,
      is_stopped: row.is_stopped,
      stop_reason: row.stop_reason || undefined,
      stop_timestamp: row.stop_timestamp ? new Date(row.stop_timestamp).getTime() : undefined
    });
  } catch (err) {
    console.error('[Ingredients] Ошибка PUT:', err);
    res.status(500).json({ error: 'Ошибка обновления ингредиента' });
  }
});

/** DELETE /api/ingredients/:id — Удалить ингредиент (каскадно удаляет children через FK) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM slicer_ingredients WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ингредиент не найден' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Ingredients] Ошибка DELETE:', err);
    res.status(500).json({ error: 'Ошибка удаления ингредиента' });
  }
});

/**
 * POST /api/ingredients/:id/image — Загрузить фото ингредиента.
 * multipart/form-data, поле `image`. Файл сохраняется в
 * server/public/images/ingredients/<id>.<ext>, путь пишется в image_url.
 * Если было старое фото с другим расширением — удаляется с диска.
 */
router.post('/:id/image', validateIngredientUuid, uploadIngredientImage.single('image'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      res.status(400).json({ error: 'Файл не передан (ожидается поле "image")' });
      return;
    }

    const relativePath = `/images/ingredients/${req.file.filename}`;

    // Удаляем старый файл если расширение поменялось (jpg → png)
    const prev = await pool.query('SELECT image_url FROM slicer_ingredients WHERE id = $1', [id]);
    if (prev.rows.length && prev.rows[0].image_url && prev.rows[0].image_url !== relativePath) {
      const oldFile = path.resolve(__dirname, '../../public' + prev.rows[0].image_url);
      // Defence-in-depth: даже если БД-значение испорчено traversal-сегментами,
      // не unlink-аем ничего вне UPLOAD_DIR_ING.
      if (isPathInside(oldFile, UPLOAD_DIR_ING) && fs.existsSync(oldFile)) {
        try { fs.unlinkSync(oldFile); }
        catch (e) { console.warn('[Ingredients] Не удалось удалить старый файл:', oldFile, e); }
      }
    }

    const result = await pool.query(
      `UPDATE slicer_ingredients
          SET image_url = $2,
              image_content_type = $3,
              image_file_size = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [id, relativePath, req.file.mimetype, req.file.size]
    );

    if (result.rows.length === 0) {
      // UPDATE не нашёл запись — файл на диске уже лежит, но принадлежности нет.
      // Удаляем файл чтобы не оставлять мусор.
      try { fs.unlinkSync(path.join(UPLOAD_DIR_ING, req.file.filename)); } catch {}
      res.status(404).json({ error: 'Ингредиент не найден' });
      return;
    }

    res.json({ image_url: relativePath });
  } catch (err) {
    console.error('[Ingredients] Ошибка upload image:', err);
    res.status(500).json({ error: 'Ошибка загрузки фото ингредиента' });
  }
});

/**
 * DELETE /api/ingredients/:id/image — Удалить фото ингредиента.
 * Очищает image_url в БД и удаляет файл с диска. Идемпотентный.
 */
router.delete('/:id/image', validateIngredientUuid, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const row = await pool.query('SELECT image_url FROM slicer_ingredients WHERE id = $1', [id]);
    if (row.rows.length && row.rows[0].image_url) {
      const filePath = path.resolve(__dirname, '../../public' + row.rows[0].image_url);
      // Defence-in-depth: unlink только если внутри UPLOAD_DIR_ING.
      if (isPathInside(filePath, UPLOAD_DIR_ING) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); }
        catch (e) { console.warn('[Ingredients] Не удалось удалить файл:', filePath, e); }
      }
    }
    await pool.query(
      `UPDATE slicer_ingredients
          SET image_url = NULL,
              image_content_type = NULL,
              image_file_size = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Ingredients] Ошибка delete image:', err);
    res.status(500).json({ error: 'Ошибка удаления фото ингредиента' });
  }
});

export default router;
