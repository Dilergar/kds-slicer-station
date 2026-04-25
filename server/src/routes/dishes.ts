/**
 * Маршруты для получения блюд из справочника ctlg15_dishes (существующая КДС таблица).
 * Читаем блюда и обогащаем рецептами из slicer_recipes.
 *
 * ВАЖНО: применяется whitelist по цехам (storage) — аналогично GET /api/orders.
 * Показываются только блюда которые хоть раз заказывались через кухонный склад.
 * Это гарантирует что в "Рецепты" попадают только кухонные блюда (не бар, не хозка).
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../config/db';

const router = Router();

/**
 * UUID v4-формат (canonical lowercase/uppercase, с дефисами). Используется как
 * валидатор параметра :dishId перед multer/fs операциями, чтобы предотвратить
 * path traversal через значения вроде `..`, `con`, `.htaccess`, NUL-bytes и т.п.
 *
 * Только этот формат принимается как dish_id в эндпоинтах работы с файлами —
 * в реальности dish_id в нашей БД это UUID из ctlg15_dishes.suuid.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware: блокирует запрос если :dishId не валидный UUID. Должен идти ПЕРЕД
 * `upload.single('image')`, чтобы multer не успел записать файл с опасным именем
 * на диск.
 */
function validateDishUuid(req: Request, res: Response, next: NextFunction): void {
  const dishId = req.params.dishId;
  if (typeof dishId !== 'string' || !UUID_RE.test(dishId)) {
    res.status(400).json({ error: 'Некорректный dishId (ожидается UUID)' });
    return;
  }
  next();
}

/**
 * Гарантирует что resolved-путь file находится строго внутри baseDir. Защита
 * от path traversal через символы `..` или абсолютные пути в image_path,
 * прочитанном из БД (на случай если строка туда попала помимо upload-роута).
 *
 * Возвращает true если путь безопасен и можно использовать с fs.unlink/readFile.
 */
function isPathInside(filePath: string, baseDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep);
}

/**
 * Папка для загруженных фото блюд. Создаётся при старте модуля если её нет.
 * В dev Vite проксирует /images на backend (vite.config.ts), в проде —
 * nginx раздаёт public/images напрямую.
 *
 * __dirname:
 *   dev (ts-node-dev): <repo>/server/src/routes → UPLOAD_DIR = <repo>/server/public/images/dishes
 *   prod (tsc build):  <repo>/server/dist/routes → тот же путь, потому что ../../public
 */
const UPLOAD_DIR = path.resolve(__dirname, '../../public/images/dishes');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Multer-конфиг: файл кладётся с именем <dishId>.<ext>.
 * Старое фото того же блюда перезаписывается (если расширение совпало),
 * либо явно удаляется в хэндлере (если расширение сменилось — jpg→png).
 */
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${req.params.dishId}${ext}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ жёсткий лимит
  fileFilter: (_req, file, cb) => {
    // Whitelist: только реальные форматы картинок. Отсекает попытки залить
    // exe/html/svg под видом изображения.
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый формат файла (только JPEG/PNG/GIF/WEBP)'));
    }
  }
});

/**
 * Whitelist кухонных складов. Синхронизирован с KITCHEN_STORAGE_UUIDS из orders.ts.
 * Блюдо попадает в рецепты если имеет хотя бы один заказ из этого цеха.
 */
const KITCHEN_STORAGE_UUIDS = [
  '123fa359-1d49-45d5-a4cc-74ef265f4548', // Кухня
];

/**
 * GET /api/dishes — Получить кухонные блюда из ctlg15_dishes.
 *
 * Блюдо попадает в список если ХОТЯ БЫ ОДНО из условий выполнено:
 *
 *   1. Блюдо есть в меню (ctlg18_menuitems) с кухонным складом
 *      → новые блюда появляются сразу после добавления в меню, ещё
 *        до первого заказа.
 *
 *   2. Блюдо хотя бы раз заказывалось из кухонного склада
 *      (docm2tabl1_items) → fallback для старых блюд.
 *
 * JOIN с slicer_recipes для получения ингредиентов рецепта.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Параметры подставляются дважды — для menuitems и для items
    const storageParams = KITCHEN_STORAGE_UUIDS.map((_, i) => `$${i + 1}`).join(', ');

    const dishesResult = await pool.query(`
      SELECT DISTINCT
        d.suuid AS id,
        d.name,
        d.code,
        d.ctlg15_ctlg38_uuid__goodcategory AS category_uuid,
        -- Источник рецепта: primary если есть алиас, иначе само блюдо
        COALESCE(alias.primary_dish_id, d.suuid::text) AS recipe_source_id
      FROM ctlg15_dishes d
      LEFT JOIN slicer_dish_aliases alias ON alias.alias_dish_id = d.suuid::text
      WHERE d.isfolder = false
        AND d.name IS NOT NULL
        AND d.name != ''
        AND (
          -- Источник 1: блюдо в меню с кухонным складом (для новых блюд)
          EXISTS (
            SELECT 1 FROM ctlg18_menuitems mi
            WHERE mi.ctlg18_ctlg15_uuid__dish = d.suuid
              AND mi.isfolder = false
              AND mi.ctlg18_ctlg17_uuid__storage IN (${storageParams})
          )
          -- Источник 2: блюдо хоть раз заказывалось с кухни (fallback)
          OR EXISTS (
            SELECT 1 FROM docm2tabl1_items i
            WHERE i.docm2tabl1_ctlg15_uuid__dish = d.suuid
              AND i.docm2tabl1_ctlg17_uuid__storage IN (${storageParams})
          )
        )
      ORDER BY d.name
    `, KITCHEN_STORAGE_UUIDS);

    // Получаем все рецепты сразу (одним запросом)
    const recipesResult = await pool.query(`
      SELECT r.dish_id, r.ingredient_id, r.quantity_per_portion
      FROM slicer_recipes r
    `);

    // Ручные назначения категорий блюдам (slicer_dish_categories).
    // Одно блюдо может иметь несколько категорий. Если строк нет —
    // блюдо попадёт в секцию «Без категории» на фронтенде.
    const dishCatsResult = await pool.query(`
      SELECT dish_id, array_agg(category_id::text) AS category_ids
      FROM slicer_dish_categories
      GROUP BY dish_id
    `);
    const categoriesByDish = new Map<string, string[]>();
    for (const r of dishCatsResult.rows) {
      categoriesByDish.set(r.dish_id, r.category_ids);
    }

    // Стоп-лист блюд: UNION двух источников.
    //  1. rgst3_dishstoplist — стоп-лист основной KDS (кассиры, read-only).
    //     ВАЖНО: эта таблица — архив по сменам. При закрытии смены строки
    //     не удаляются, а остаются для истории. Поэтому фильтруем по
    //     открытой смене (ctlg14_closed = false), иначе тянем весь архив
    //     за годы и помечаем стопнутыми сотни блюд, которые на самом деле
    //     активны прямо сейчас.
    //  2. slicer_dish_stoplist — стоп-лист модуля нарезчика:
    //     MANUAL (ручной) + CASCADE (автоматически от стопа ингредиента)
    // Причина (reason) из slicer_dish_stoplist имеет приоритет — там есть
    // осмысленный текст «Missing: <ingredient>» или ручная причина.
    // Добавляем stopped_at из реальных таблиц — раньше на фронт улетал
    // Date.now() при каждом GET, из-за чего длительность в Истории стоп-листов
    // сбрасывалась на 0 при каждом reload dishes. Берём:
    //   - rgst3_dishstoplist.insert_date — когда основная KDS поставила стоп
    //   - slicer_dish_stoplist.stopped_at — когда наш модуль поставил стоп
    const stoplistResult = await pool.query(`
      SELECT r.rgst3_ctlg15_uuid__dish::text AS dish_uuid,
             NULL::text AS reason,
             r.insert_date AS stopped_at
      FROM rgst3_dishstoplist r
      JOIN ctlg14_shifts s ON s.suuid = r.rgst3_ctlg14_uuid__shift
      WHERE s.ctlg14_closed = false
      UNION ALL
      SELECT dish_id AS dish_uuid, reason, stopped_at
      FROM slicer_dish_stoplist
    `);
    const stoppedDishReasons = new Map<string, string | null>();
    const stoppedDishTimestamps = new Map<string, number>();
    for (const r of stoplistResult.rows) {
      // Если блюдо встретилось дважды — slicer_dish_stoplist (с текстом reason)
      // побеждает запись из rgst3 (где reason всегда NULL).
      const prev = stoppedDishReasons.get(r.dish_uuid);
      if (prev == null || r.reason != null) {
        stoppedDishReasons.set(r.dish_uuid, r.reason);
      }
      // Для timestamp берём самый ранний — показывает реальный момент когда
      // блюдо впервые стопнулось (если есть в обеих таблицах).
      const ts = r.stopped_at ? new Date(r.stopped_at).getTime() : null;
      if (ts != null) {
        const prevTs = stoppedDishTimestamps.get(r.dish_uuid);
        if (prevTs == null || ts < prevTs) {
          stoppedDishTimestamps.set(r.dish_uuid, ts);
        }
      }
    }
    const stoppedDishUuids = new Set(stoppedDishReasons.keys());

    // Индексируем рецепты по dish_id для быстрого поиска
    const recipesByDish = new Map<string, { id: string; quantity: number }[]>();
    for (const r of recipesResult.rows) {
      const dishId = r.dish_id;
      if (!recipesByDish.has(dishId)) recipesByDish.set(dishId, []);
      recipesByDish.get(dishId)!.push({
        id: r.ingredient_id,
        quantity: Number(r.quantity_per_portion)
      });
    }

    // Фото блюд: отдельная slicer_dish_images хранит relative-путь к файлу
    // на диске (/images/dishes/<uuid>.<ext>). В БД — только строка; файлы
    // отдаёт Express static с кэшем браузера. См. routes/dishes.ts ниже
    // (POST /:id/image / DELETE /:id/image).
    const imagesResult = await pool.query(`SELECT dish_id, image_path FROM slicer_dish_images`);
    const imagesByDish = new Map<string, string>();
    for (const r of imagesResult.rows) {
      imagesByDish.set(r.dish_id, r.image_path);
    }

    // Приоритет отображения блюда (NORMAL=1 / ULTRA=3). Хранится per-dish
    // в slicer_dish_priority. Отсутствие записи = NORMAL (дефолт).
    // Не делаем JOIN в основном запросе, чтобы не усложнять и не дублировать
    // строки — собираем Map аналогично категориям/фото.
    const priorityResult = await pool.query(`SELECT dish_id, priority_flag FROM slicer_dish_priority`);
    const priorityByDish = new Map<string, number>();
    for (const r of priorityResult.rows) {
      priorityByDish.set(r.dish_id, Number(r.priority_flag));
    }

    // Флаг «требует разморозки» (миграция 016) + per-dish время в минутах
    // (миграция 020). Хранится на уровне primary-блюда: на чтении резолвим
    // через recipe_source_id — алиасы наследуют от primary (тот же паттерн
    // что и рецепт). Отсутствие записи = { requires_defrost: false, minutes: 15 }.
    const defrostResult = await pool.query(
      `SELECT dish_id, requires_defrost, defrost_duration_minutes FROM slicer_dish_defrost`
    );
    const defrostByDish = new Map<string, { requires: boolean; minutes: number }>();
    for (const r of defrostResult.rows) {
      defrostByDish.set(r.dish_id, {
        requires: Boolean(r.requires_defrost),
        minutes: Number(r.defrost_duration_minutes)
      });
    }

    // Формируем ответ в формате Dish[]
    const dishes = dishesResult.rows.map(row => {
      // Ингредиенты берём по recipe_source_id: для primary/standalone это row.id,
      // для alias — это primary_dish_id. Один рецепт для всех связанных вариантов.
      const ingredients = recipesByDish.get(row.recipe_source_id) || [];
      const gramsPerPortion = ingredients.reduce((sum, ing) => sum + ing.quantity, 0);
      const isStopped = stoppedDishUuids.has(row.id);
      const stopReason = isStopped
        ? stoppedDishReasons.get(row.id) || 'KDS Stop List'
        : '';

      // Категории: берём из ручных назначений. Если нет — пустой массив,
      // и блюдо попадает в секцию «Без категории» в RecipeEditor.
      const assignedCategories = categoriesByDish.get(row.id) || [];

      // Префикс в имени: показываем код блюда нарезчику для различения вариантов
      // (например "202 Суп Кунг-фу" vs "Д202 Суп Кунг Фу" — зал vs доставка)
      const displayName = row.code ? `${row.code} ${row.name}` : row.name;

      return {
        id: row.id,
        name: displayName,
        code: row.code || undefined,
        recipe_source_id: row.recipe_source_id, // id primary блюда (или сам id если нет алиаса)
        category_ids: assignedCategories,
        priority_flag: priorityByDish.get(row.id) ?? 1, // 1=NORMAL, 3=ULTRA; отсутствие записи = NORMAL
        // Флаг и время разморозки читаем по recipe_source_id — алиасы
        // наследуют от primary. Отсутствие записи = дефолты (false / 15 мин).
        requires_defrost: defrostByDish.get(row.recipe_source_id)?.requires ?? false,
        defrost_duration_minutes: defrostByDish.get(row.recipe_source_id)?.minutes ?? 15,
        grams_per_portion: gramsPerPortion,
        ingredients,
        image_url: imagesByDish.get(row.id) || '',
        is_stopped: isStopped,
        stop_reason: stopReason,
        // Реальный момент стопа из БД (не Date.now()!) — стабильный между
        // polling'ами, благодаря чему Dashboard-таймер не сбрасывается.
        stop_timestamp: isStopped ? stoppedDishTimestamps.get(row.id) : undefined
      };
    });

    res.json(dishes);
  } catch (err) {
    console.error('[Dishes] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения блюд' });
  }
});

/**
 * PUT /api/dishes/:dishId/categories — Назначить блюду список slicer-категорий.
 * Body: { category_ids: string[] } — массив id из slicer_categories.
 * Полная замена: удаляем старые назначения и вставляем новые в одной транзакции.
 * Используется из RecipeEditor при сохранении рецепта.
 */
router.put('/:dishId/categories', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids)) {
      res.status(400).json({ error: 'category_ids должен быть массивом' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем все прежние назначения для этого блюда
      await client.query(
        'DELETE FROM slicer_dish_categories WHERE dish_id = $1',
        [dishId]
      );

      // Вставляем новые назначения. ON CONFLICT DO NOTHING — защита от дубликатов
      // если в body пришёл один и тот же category_id дважды.
      for (const catId of category_ids) {
        await client.query(
          `INSERT INTO slicer_dish_categories (dish_id, category_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [dishId, catId]
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
    console.error('[Dishes] Ошибка PUT categories:', err);
    res.status(500).json({ error: 'Ошибка назначения категорий блюда' });
  }
});

/**
 * PUT /api/dishes/:dishId/priority — Назначить блюду приоритет отображения.
 * Body: { priority_flag: 1 | 3 } — NORMAL или ULTRA.
 * UPSERT в slicer_dish_priority. Используется из RecipeEditor.
 */
router.put('/:dishId/priority', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const { priority_flag } = req.body;

    // Whitelist: только допустимые значения PriorityLevel. Иначе CHECK в
    // миграции всё равно упадёт, но вернём 400 заранее с понятным текстом.
    if (priority_flag !== 1 && priority_flag !== 3) {
      res.status(400).json({ error: 'priority_flag должен быть 1 (NORMAL) или 3 (ULTRA)' });
      return;
    }

    await pool.query(
      `INSERT INTO slicer_dish_priority (dish_id, priority_flag)
       VALUES ($1, $2)
       ON CONFLICT (dish_id) DO UPDATE SET
         priority_flag = $2,
         updated_at = NOW()`,
      [dishId, priority_flag]
    );
    res.json({ updated: true });
  } catch (err) {
    console.error('[Dishes] Ошибка PUT priority:', err);
    res.status(500).json({ error: 'Ошибка сохранения приоритета' });
  }
});

/**
 * PUT /api/dishes/:dishId/defrost — Назначить блюду флаг «требует разморозки?»
 * и per-dish время разморозки в минутах (миграция 020).
 * Body: { requires_defrost: boolean, defrost_duration_minutes?: number }.
 * UPSERT в slicer_dish_defrost. Значение хранится на dish_id как пришёл;
 * резолв alias→primary делает вызывающий код (RecipeEditor подставляет primary
 * перед отправкой — так же как для рецепта), иначе запись повесится на alias
 * отдельно от primary.
 * defrost_duration_minutes: если не передан — используем дефолт 15. Валидация
 * 1..60 дублирует CHECK в БД, чтобы 400 с понятным текстом вместо 500.
 */
router.put('/:dishId/defrost', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const { requires_defrost, defrost_duration_minutes } = req.body;

    if (typeof requires_defrost !== 'boolean') {
      res.status(400).json({ error: 'requires_defrost должен быть boolean' });
      return;
    }

    // Дефолт 15 — если клиент отправил только requires_defrost (старый контракт)
    // или выключает флаг и минуты неважны. CHECK 1..60 в миграции 020.
    const minutes = defrost_duration_minutes ?? 15;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      res.status(400).json({ error: 'defrost_duration_minutes должен быть целым числом 1..60' });
      return;
    }

    await pool.query(
      `INSERT INTO slicer_dish_defrost (dish_id, requires_defrost, defrost_duration_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (dish_id) DO UPDATE SET
         requires_defrost = $2,
         defrost_duration_minutes = $3,
         updated_at = NOW()`,
      [dishId, requires_defrost, minutes]
    );
    res.json({ updated: true });
  } catch (err) {
    console.error('[Dishes] Ошибка PUT defrost:', err);
    res.status(500).json({ error: 'Ошибка сохранения флага разморозки' });
  }
});

/**
 * DELETE /api/dishes/:dishId/slicer-data — Сбросить slicer-настройки блюда.
 *
 * Полностью очищает данные модуля нарезчика для указанного блюда:
 *  - `slicer_recipes`        — удаляются все ингредиенты рецепта
 *  - `slicer_dish_categories`— удаляются все назначения категорий
 *  - `slicer_dish_aliases`   — удаляются связи где блюдо является alias ИЛИ primary
 *
 * ВАЖНО: чужая таблица `ctlg15_dishes` НЕ трогается — само блюдо остаётся в
 * системе заказчика. После этого `GET /api/dishes` снова вернёт блюдо, но уже
 * с пустыми ингредиентами и без категорий — оно попадёт в секцию «Без категории»
 * в RecipeEditor и готово к повторной настройке.
 *
 * Edge-case: если удаляют primary-блюдо, у которого были alias'ы — связи
 * разрываются, alias'ы становятся standalone-блюдами с собственными (пустыми)
 * slicer-данными. Это ожидаемое поведение.
 */
router.delete('/:dishId/slicer-data', async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const recipesRes = await client.query(
        'DELETE FROM slicer_recipes WHERE dish_id = $1',
        [dishId]
      );
      const categoriesRes = await client.query(
        'DELETE FROM slicer_dish_categories WHERE dish_id = $1',
        [dishId]
      );
      const aliasesRes = await client.query(
        'DELETE FROM slicer_dish_aliases WHERE alias_dish_id = $1 OR primary_dish_id = $1',
        [dishId]
      );
      // Сбрасываем также приоритет — при повторной настройке блюда через
      // RecipeEditor он начнётся с NORMAL (дефолт при отсутствии записи).
      const priorityRes = await client.query(
        'DELETE FROM slicer_dish_priority WHERE dish_id = $1',
        [dishId]
      );
      // И флаг разморозки (миграция 016) — чтобы сброшенное блюдо при повторной
      // настройке начиналось с чистого «не требует разморозки».
      const defrostRes = await client.query(
        'DELETE FROM slicer_dish_defrost WHERE dish_id = $1',
        [dishId]
      );

      await client.query('COMMIT');

      res.json({
        cleared: true,
        deleted: {
          recipes: recipesRes.rowCount ?? 0,
          categories: categoriesRes.rowCount ?? 0,
          aliases: aliasesRes.rowCount ?? 0,
          priority: priorityRes.rowCount ?? 0,
          defrost: defrostRes.rowCount ?? 0
        }
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Dishes] Ошибка DELETE slicer-data:', err);
    res.status(500).json({ error: 'Ошибка сброса slicer-данных блюда' });
  }
});

/**
 * POST /api/dishes/:dishId/image — Загрузить фото блюда.
 *
 * Принимает multipart/form-data с полем `image`. Файл физически
 * сохраняется в server/public/images/dishes/<dishId>.<ext>, в БД
 * (slicer_dish_images) пишется относительный URL `/images/dishes/...`.
 *
 * Если у блюда уже было фото с другим расширением (jpg → png) —
 * удаляем старый файл с диска, чтобы не оставлять мусор.
 *
 * multer-ошибки (слишком большой файл, неправильный mimetype) возвращаются
 * как 400 клиенту — их ловит глобальный errorHandler.
 */
router.post('/:dishId/image', validateDishUuid, upload.single('image'), async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    if (!req.file) {
      res.status(400).json({ error: 'Файл не передан (ожидается поле "image")' });
      return;
    }

    const relativePath = `/images/dishes/${req.file.filename}`;

    // Если расширение сменилось — старый файл остаётся на диске мусором.
    // Находим прежний image_path и удаляем если имя не совпадает с новым.
    const prev = await pool.query(
      'SELECT image_path FROM slicer_dish_images WHERE dish_id = $1',
      [dishId]
    );
    if (prev.rows.length && prev.rows[0].image_path !== relativePath) {
      const oldFile = path.resolve(__dirname, '../../public' + prev.rows[0].image_path);
      // Defence-in-depth: даже если в БД попал traversal-путь, не unlink-аем
      // ничего вне UPLOAD_DIR (только наша папка с фото блюд).
      if (isPathInside(oldFile, UPLOAD_DIR) && fs.existsSync(oldFile)) {
        try { fs.unlinkSync(oldFile); }
        catch (e) { console.warn('[Dishes] Не удалось удалить старый файл:', oldFile, e); }
      }
    }

    await pool.query(
      `INSERT INTO slicer_dish_images (dish_id, image_path, content_type, file_size, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (dish_id) DO UPDATE SET
         image_path   = EXCLUDED.image_path,
         content_type = EXCLUDED.content_type,
         file_size    = EXCLUDED.file_size,
         updated_at   = NOW()`,
      [dishId, relativePath, req.file.mimetype, req.file.size]
    );

    res.json({ image_url: relativePath });
  } catch (err) {
    console.error('[Dishes] Ошибка upload image:', err);
    res.status(500).json({ error: 'Ошибка загрузки фото блюда' });
  }
});

/**
 * DELETE /api/dishes/:dishId/image — Удалить фото блюда.
 * Убирает запись из slicer_dish_images и удаляет файл с диска.
 * Идемпотентный: если фото нет — вернёт 200 с deleted:false.
 */
router.delete('/:dishId/image', validateDishUuid, async (req: Request, res: Response) => {
  try {
    const { dishId } = req.params;
    const row = await pool.query(
      'SELECT image_path FROM slicer_dish_images WHERE dish_id = $1',
      [dishId]
    );
    if (!row.rows.length) {
      res.json({ deleted: false });
      return;
    }
    const filePath = path.resolve(__dirname, '../../public' + row.rows[0].image_path);
    // Defence-in-depth: unlink только если путь внутри UPLOAD_DIR.
    if (isPathInside(filePath, UPLOAD_DIR) && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); }
      catch (e) { console.warn('[Dishes] Не удалось удалить файл:', filePath, e); }
    }
    await pool.query('DELETE FROM slicer_dish_images WHERE dish_id = $1', [dishId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Dishes] Ошибка delete image:', err);
    res.status(500).json({ error: 'Ошибка удаления фото блюда' });
  }
});

export default router;
