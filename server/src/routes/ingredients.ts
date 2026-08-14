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
import { extensionForMime, imageFileFilter, verifyImageSignature } from '../utils/imageUpload';

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

/**
 * Multer-конфиг: файл кладётся с именем `<id>_<метка времени>.<ext>`.
 *
 * Метка времени обязательна. Раньше имя было просто `<id>.<ext>`, то есть при
 * перезаливке фото адрес картинки не менялся. Статика отдаётся с заголовком
 * `Cache-Control: public, max-age=604800` (см. index.ts), поэтому браузер
 * неделю показывал СТАРУЮ картинку, не переспрашивая сервер: новый файл лежал
 * на диске, а на планшете висело прежнее фото. На кухне это опаснее всего —
 * никто не будет делать hard refresh, чтобы увидеть правильную нарезку.
 *
 * Меняющееся имя даёт новый URL при каждой загрузке → кэш промахивается и
 * картинка обновляется мгновенно. Старый файл при этом не копится: хэндлер
 * ниже удаляет прежний, раз путь в БД отличается от нового.
 */
const ingredientUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_ING),
  filename: (req, file, cb) => {
    // Расширение — из белого списка по проверенному типу, НЕ из имени файла:
    // и имя, и Content-Type присылает клиент, поэтому `x.html` с заголовком
    // `image/png` раньше сохранялся как .html в папку статики (см. utils/imageUpload.ts).
    cb(null, `${req.params.id}_${Date.now()}${extensionForMime(file.mimetype)}`);
  }
});

const uploadIngredientImage = multer({
  storage: ingredientUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ
  fileFilter: imageFileFilter
});

/** GET /api/ingredients — Получить все ингредиенты (с иерархией) */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      // stopped_by_* нужны отчёту: в секции «Активные сейчас» до этого не было
      // ответа на вопрос «кто и зачем поставил» — актор появлялся только после
      // снятия стопа, то есть когда спрашивать уже поздно. Ровно ради этого
      // делалась миграция 014, но поля не доходили до клиента.
      `SELECT id, name, parent_id, image_url, unit_type, piece_weight_grams, buffer_percent,
              is_stopped, stop_reason, stop_timestamp, stopped_by_uuid, stopped_by_name
         FROM slicer_ingredients
        ORDER BY parent_id NULLS FIRST, name`
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
      stop_timestamp: row.stop_timestamp ? new Date(row.stop_timestamp).getTime() : undefined,
      // Кто поставил текущий стоп — для секции «Активные сейчас» в отчёте
      stopped_by_uuid: row.stopped_by_uuid || undefined,
      stopped_by_name: row.stopped_by_name || undefined
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

/**
 * PUT /api/ingredients/:id/rename-parent — Переименовать сырьё одной транзакцией.
 *
 * Body: { name: string }
 *
 * Зачем отдельный эндпоинт. Приставка сырья хранится прямо в названии
 * разновидности («Вешенки · Крупная соломка», паттерн 3 в CLAUDE.md), поэтому
 * при переименовании сырья её нужно переписать во ВСЕХ его разновидностях.
 * Раньше это делал клиент: отдельный PUT на родителя и по отдельному PUT на
 * каждого ребёнка, без ожидания и без объединения — семь записей и семь полных
 * перезагрузок справочника параллельно. Достаточно было моргнуть Wi-Fi, и
 * родитель оказывался переименован, а половина разновидностей — нет; ошибка при
 * этом уходила в консоль. Дальше рассогласованные имена накапливали приставки.
 *
 * Здесь всё в одной транзакции: либо переименовалось всё, либо ничего.
 * Приставка снимается по разделителю, а не по старому имени родителя — так
 * чинятся и записи, которые уже разошлись.
 *
 * Response: { renamed: true, children: N }
 */
router.put('/:id/rename-parent', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Название сырья не может быть пустым' });
      return;
    }
    const newName = name.trim();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const parentRes = await client.query(
        'SELECT id, name, parent_id FROM slicer_ingredients WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (parentRes.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Сырьё не найдено' });
        return;
      }
      if (parentRes.rows[0].parent_id) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Это разновидность, а не сырьё — переименуйте её обычным способом' });
        return;
      }

      await client.query(
        'UPDATE slicer_ingredients SET name = $2, updated_at = NOW() WHERE id = $1',
        [id, newName]
      );

      // Переписываем приставку у разновидностей.
      // split_part(name, ' · ', ...) снимает ЛЮБУЮ существующую приставку —
      // в том числе протухшую от прошлого неудачного переименования.
      // Разделитель тот же VARIETY_SEPARATOR, что в utils.ts.
      const childrenRes = await client.query(
        `UPDATE slicer_ingredients
            SET name = $2 || ' · ' ||
                CASE
                  WHEN position(' · ' in name) > 0
                    THEN substring(name from position(' · ' in name) + 3)
                  ELSE name
                END,
                updated_at = NOW()
          WHERE parent_id = $1
          RETURNING id`,
        [id, newName]
      );

      await client.query('COMMIT');
      res.json({ renamed: true, children: childrenRes.rowCount ?? 0 });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Ingredients] Ошибка rename-parent:', err);
    res.status(500).json({ error: 'Ошибка переименования сырья' });
  }
});

/**
 * GET /api/ingredients/:id/usage — Что заденет удаление этого ингредиента.
 *
 * Нужен диалогу подтверждения: удаление сырья каскадит на разновидности
 * (parent_id ON DELETE CASCADE), а каждая разновидность — на slicer_recipes.
 * То есть вместе с сырьём из ВСЕХ рецептов молча исчезают строки, и блюда
 * теряют компонент — на карточке заказа его больше не будет. Диалог при этом
 * предупреждал только про разновидности.
 *
 * Response: { children, recipes, activeStops }
 */
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `WITH family AS (
         SELECT id FROM slicer_ingredients WHERE id = $1
         UNION
         SELECT id FROM slicer_ingredients WHERE parent_id = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM slicer_ingredients WHERE parent_id = $1) AS children,
         (SELECT COUNT(DISTINCT r.dish_id)::int
            FROM slicer_recipes r WHERE r.ingredient_id IN (SELECT id FROM family)) AS recipes,
         (SELECT COUNT(*)::int
            FROM slicer_ingredients i
           WHERE i.id IN (SELECT id FROM family) AND i.is_stopped = true) AS active_stops`,
      [id]
    );
    const row = result.rows[0] ?? { children: 0, recipes: 0, active_stops: 0 };
    res.json({
      children: row.children ?? 0,
      recipes: row.recipes ?? 0,
      activeStops: row.active_stops ?? 0,
    });
  } catch (err) {
    console.error('[Ingredients] Ошибка usage:', err);
    res.status(500).json({ error: 'Ошибка проверки использования ингредиента' });
  }
});

/** DELETE /api/ingredients/:id — Удалить ингредиент (каскадно удаляет children через FK) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Сначала забираем пути к фото — своё и всех разновидностей.
    // Удаление каскадит на children через FK, и без этого их файлы оставались
    // на диске навсегда: сейчас там уже лежат сироты от прежних удалений.
    const imagesRes = await pool.query(
      `SELECT image_url FROM slicer_ingredients
        WHERE (id = $1 OR parent_id = $1) AND image_url IS NOT NULL AND image_url <> ''`,
      [id]
    );

    const result = await pool.query('DELETE FROM slicer_ingredients WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ингредиент не найден' });
      return;
    }

    // Файлы удаляем ПОСЛЕ успешного удаления из БД: если запрос упадёт,
    // картинки останутся на месте вместе со своими записями.
    for (const row of imagesRes.rows) {
      const file = path.resolve(__dirname, '../../public' + row.image_url);
      // Defence-in-depth: испорченный путь в БД не должен вывести unlink за папку
      if (isPathInside(file, UPLOAD_DIR_ING) && fs.existsSync(file)) {
        try { fs.unlinkSync(file); }
        catch (e) { console.warn('[Ingredients] Не удалось удалить фото:', file, e); }
      }
    }

    res.json({ deleted: true, removedImages: imagesRes.rows.length });
  } catch (err) {
    console.error('[Ingredients] Ошибка DELETE:', err);
    res.status(500).json({ error: 'Ошибка удаления ингредиента' });
  }
});

/**
 * POST /api/ingredients/:id/image — Загрузить фото ингредиента.
 * multipart/form-data, поле `image`. Файл сохраняется в
 * server/public/images/ingredients/<id>_<метка времени>.<ext>,
 * путь пишется в image_url. Имя каждый раз новое (см. ingredientUploadStorage
 * выше — обход кэша браузера), поэтому прежний файл всегда удаляем с диска.
 */
router.post('/:id/image', validateIngredientUuid, uploadIngredientImage.single('image'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      res.status(400).json({ error: 'Файл не передан (ожидается поле "image")' });
      return;
    }

    // Содержимое должно быть настоящей картинкой, а не просто заявленной таковой
    // в заголовке. Проверяем после записи — multer пишет файл потоком.
    const savedPath = path.join(UPLOAD_DIR_ING, req.file.filename);
    if (!verifyImageSignature(savedPath)) {
      try { fs.unlinkSync(savedPath); } catch { /* уже нет */ }
      res.status(400).json({ error: 'Файл не является изображением' });
      return;
    }

    const relativePath = `/images/ingredients/${req.file.filename}`;

    // Запоминаем прежний путь ДО обновления — сам файл удалим уже после того,
    // как новая ссылка окажется в БД.
    const prev = await pool.query('SELECT image_url FROM slicer_ingredients WHERE id = $1', [id]);
    const oldUrl: string | null = prev.rows[0]?.image_url ?? null;

    // ⚠️ Порядок: СНАЧАЛА запись в БД, ПОТОМ удаление прежнего файла.
    // Раньше было наоборот, и если UPDATE падал (оборвалось соединение с БД),
    // пользователь видел ошибку и обнаруживал, что старого фото тоже больше нет:
    // путь в БД остался, а файла на диске уже не было.
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

    // Прежний файл удаляем только после успешного коммита новой ссылки
    if (oldUrl && oldUrl !== relativePath) {
      const oldFile = path.resolve(__dirname, '../../public' + oldUrl);
      // Defence-in-depth: даже если БД-значение испорчено traversal-сегментами,
      // не unlink-аем ничего вне UPLOAD_DIR_ING.
      if (isPathInside(oldFile, UPLOAD_DIR_ING) && fs.existsSync(oldFile)) {
        try { fs.unlinkSync(oldFile); }
        catch (e) { console.warn('[Ingredients] Не удалось удалить старый файл:', oldFile, e); }
      }
    }

    res.json({ image_url: relativePath });
  } catch (err) {
    console.error('[Ingredients] Ошибка upload image:', err);
    // Запись в БД не состоялась — только что загруженный файл никому не нужен
    if (req.file) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR_ING, req.file.filename)); } catch { /* уже нет */ }
    }
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
