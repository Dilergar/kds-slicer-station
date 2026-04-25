/**
 * Маршруты для работы с заказами нарезчика.
 *
 * Заказы ЧИТАЮТСЯ из существующих таблиц KDS (docm2_orders + docm2tabl1_items),
 * а состояние нарезчика (парковка, статус) хранится в slicer_order_state.
 *
 * ВАЖНО: модуль НЕ пишет в чужие таблицы при завершении заказа. Поле
 * docm2tabl1_items.docm2tabl1_cooked остаётся под управлением основной KDS
 * (раздача / пасс отмечают готовность всего блюда). Нарезчик закрывает ТОЛЬКО
 * свою часть — это сохраняется в slicer_order_state.status = 'COMPLETED'
 * и slicer_order_state.finished_at = NOW() (для замера времени готовки повара
 * через разницу с docm2tabl1_cooktime).
 *
 * При завершении заказа:
 * 1. INSERT/UPDATE slicer_order_state (status='COMPLETED', finished_at=NOW())
 * 2. INSERT в slicer_order_history (KPI)
 * 3. INSERT в slicer_ingredient_consumption (расход)
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/**
 * Whitelist цехов-складов (из таблицы ctlg17_storages), которые ПОКАЗЫВАЮТСЯ
 * нарезчику. Позиции заказа связаны со складом через
 * поле docm2tabl1_items.docm2tabl1_ctlg17_uuid__storage.
 *
 * Нарезчик обслуживает ТОЛЬКО кухню. Всё остальное (бар, хозка, битые ссылки
 * на удалённые склады) — не попадает в очередь.
 *
 * ВАЖНО: UUID жёстко прописан для конкретного ресторана. При деплое на
 * другой ресторан — обновить значения или вынести в slicer_settings.
 */
const KITCHEN_STORAGE_UUIDS = [
  '123fa359-1d49-45d5-a4cc-74ef265f4548', // Кухня
];

/**
 * GET /api/orders — Получить активные заказы для KDS-доски нарезчика.
 *
 * Логика:
 * 1. Берём открытые заказы (docm2_closed = false) из текущей смены
 * 2. JOIN с позициями (docm2tabl1_items), блюдами (ctlg15_dishes), столами (ctlg13_halltables)
 * 3. LEFT JOIN с slicer_order_state для парковки/статуса/finished_at
 * 4. Фильтруем:
 *    - slicer_order_state.status не в (COMPLETED, CANCELLED) — нарезчик ещё не закрыл позицию
 *    - docm2tabl1_cooked != true — защитный фильтр: если основная KDS уже
 *      отметила блюдо приготовленным (раздача/пасс), значит оно прошло пайплайн
 *      без нас и показывать его не надо
 * 5. Авто-разпарковка: если unpark_at <= NOW(), ставим ACTIVE
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // ----------------------------------------------------------------------
    // Авто-парковка десертов (миграция 017 + 019).
    // Паркуем ТОЛЬКО позиции с:
    //   - категорией = slicer_settings.dessert_category_id,
    //   - у которых ЕСТЬ хотя бы один модификатор из docm2tabl2_dishmodifiers,
    //     чьё имя в ctlg20_modifiers совпадает с одним из паттернов ILIKE из
    //     slicer_settings.dessert_trigger_modifier_patterns (default:
    //     ['Готовить%', 'Ждать%']).
    //
    // Время возврата (unpark_at):
    //   - Если найдено имя вида "Готовить к HH.00" / "Готовить к HH:MM" — парковка
    //     до сегодняшних HH:MM (today + time). Если указанное время уже прошло —
    //     OK: автоматическая разпарковка (блок ниже) сразу вернёт в ACTIVE.
    //   - Иначе ("Готовить позже", "Ждать разъяснений", свои паттерны) — парковка
    //     на dessert_auto_park_minutes (default 40 мин) от ordertime.
    //
    // На уже существующие строки slicer_order_state не переписываем (ON CONFLICT
    // DO NOTHING) — если нарезчик вручную вернул десерт раньше, мы его не паркуем
    // повторно, как и было.
    // ----------------------------------------------------------------------
    const dessertCfg = await pool.query(
      `SELECT dessert_category_id, dessert_auto_park_enabled, dessert_auto_park_minutes,
              dessert_trigger_modifier_patterns
         FROM slicer_settings WHERE id = 1`
    );
    const dessertRow = dessertCfg.rows[0];
    if (
      dessertRow?.dessert_auto_park_enabled === true &&
      dessertRow?.dessert_category_id
    ) {
      const patterns: string[] = Array.isArray(dessertRow.dessert_trigger_modifier_patterns)
        && dessertRow.dessert_trigger_modifier_patterns.length > 0
          ? dessertRow.dessert_trigger_modifier_patterns
          : ['Готовить%', 'Ждать%'];

      await pool.query(
        `
        WITH trigger_mods AS (
          -- Для каждой позиции: MAX(minutes_of_day) по модификаторам типа
          -- "Готовить к HH.MM" (если несколько — берём самое ПОЗДНЕЕ время,
          -- консервативно). NULL в minutes_of_day = у позиции есть временной
          -- модификатор без конкретного часа ("Готовить позже" / "Ждать…" и т.п.).
          -- Позиции без совпадающих модификаторов в CTE не попадают, значит не
          -- паркуются.
          SELECT
            dm.docm2tabl2_itemrow AS item_id,
            MAX(
              CASE
                WHEN m.name ~ 'к\s*\d{1,2}[.:]\d{2}' THEN
                  (regexp_match(m.name, 'к\s*(\d{1,2})[.:](\d{2})'))[1]::int * 60
                  + (regexp_match(m.name, 'к\s*(\d{1,2})[.:](\d{2})'))[2]::int
                ELSE NULL
              END
            ) AS minutes_of_day
          FROM docm2tabl2_dishmodifiers dm
          INNER JOIN ctlg20_modifiers m
            ON m.suuid = dm.docm2tabl2_ctlg20_uuid__modifier
          WHERE m.name ILIKE ANY ($3::text[])
          GROUP BY dm.docm2tabl2_itemrow
        )
        INSERT INTO slicer_order_state
          (order_item_id, status, quantity_stack, table_stack, parked_at, unpark_at, was_parked, parked_tables, parked_by_auto, updated_at)
        SELECT
          items.suuid::text,
          'PARKED',
          jsonb_build_array(items.docm2tabl1_quantity),
          CASE
            WHEN tables.ctlg13_tablenumber IS NOT NULL
              THEN jsonb_build_array(jsonb_build_array(tables.ctlg13_tablenumber))
            ELSE '[[]]'::jsonb
          END,
          items.docm2tabl1_ordertime,
          -- unpark_at:
          --   * minutes_of_day NOT NULL → сегодняшняя дата + это число минут от 00:00.
          --     Если указанное время уже в прошлом — auto-unpark ниже сразу вернёт
          --     в ACTIVE (и в этом случае KPI парковки в итоге составит <1 polling).
          --   * minutes_of_day NULL → ordertime + dessert_auto_park_minutes минут
          --     (стандартное поведение «Готовить позже» / «Ждать разъяснений»).
          CASE
            WHEN tm.minutes_of_day IS NOT NULL THEN
              (CURRENT_DATE + (tm.minutes_of_day || ' minutes')::interval)::timestamp
            ELSE
              items.docm2tabl1_ordertime + ($1::text || ' minutes')::interval
          END,
          TRUE,
          CASE WHEN tables.ctlg13_tablenumber IS NOT NULL
               THEN jsonb_build_array(tables.ctlg13_tablenumber)
               ELSE '[]'::jsonb
          END,
          TRUE,
          NOW()
        FROM docm2tabl1_items items
        INNER JOIN docm2_orders orders ON orders.suuid = items.owner
        INNER JOIN trigger_mods tm ON tm.item_id = items.suuid
        LEFT JOIN slicer_dish_aliases alias
          ON alias.alias_dish_id = items.docm2tabl1_ctlg15_uuid__dish::text
        LEFT JOIN ctlg13_halltables tables
          ON tables.suuid = orders.docm2_ctlg13_uuid__halltable
        LEFT JOIN slicer_order_state state
          ON state.order_item_id = items.suuid::text
        WHERE orders.docm2_closed = false
          AND (items.docm2tabl1_cooked IS NULL OR items.docm2tabl1_cooked = false)
          AND items.docm2tabl1_ctlg17_uuid__storage IN (${KITCHEN_STORAGE_UUIDS.map((_, i) => `$${i + 4}`).join(', ')})
          AND state.order_item_id IS NULL
          -- Auto-park срабатывает только если dessert_category — ОСНОВНАЯ
          -- категория блюда (с минимальным sort_index среди назначенных).
          -- Раньше проверяли просто EXISTS — это давало ложные срабатывания
          -- на блюдах, которым случайно назначили дессертную категорию вторичной
          -- (Закуска + Десерт). Теперь блюдо паркуется только если оно primarily
          -- десерт. Тайбрейкер по cat.id для детерминизма.
          AND (
            SELECT dc.category_id
              FROM slicer_dish_categories dc
              JOIN slicer_categories cat ON cat.id = dc.category_id
             WHERE dc.dish_id = COALESCE(alias.primary_dish_id, items.docm2tabl1_ctlg15_uuid__dish::text)
             ORDER BY cat.sort_index ASC, cat.id ASC
             LIMIT 1
          ) = $2
          -- Симметрично GET /api/orders ниже: не паркуем призраков с qty<=0.
          AND items.docm2tabl1_quantity > 0
        ON CONFLICT (order_item_id) DO NOTHING
        `,
        [
          String(dessertRow.dessert_auto_park_minutes),
          dessertRow.dessert_category_id,
          patterns,
          ...KITCHEN_STORAGE_UUIDS,
        ]
      );
    }

    // Авто-разпарковка (миграция 019 — Вариант Б парковки):
    //   * parked_by_auto = TRUE (автопарковка десертов): заказ «как будто только
    //     пришёл» — effective_created_at = unpark_at, accumulated обнуляем.
    //     Десерт встаёт в конец очереди (новый bucket по COURSE_FIFO), таймер
    //     с нуля.
    //   * parked_by_auto = FALSE (ручная парковка с unpark_at таймером): возвращаем
    //     на историческое место. accumulated_time_ms += (unpark_at - parked_at) —
    //     учитываем время парковки как «пропущенное» (формула таймера на клиенте
    //     вычитает это значение из elapsed). effective_created_at не трогаем.
    await pool.query(`
      UPDATE slicer_order_state
      SET status = 'ACTIVE',
          effective_created_at = CASE
            WHEN parked_by_auto THEN unpark_at
            ELSE effective_created_at
          END,
          accumulated_time_ms = CASE
            WHEN parked_by_auto THEN 0
            ELSE COALESCE(accumulated_time_ms, 0) +
                 (EXTRACT(EPOCH FROM (unpark_at - parked_at)) * 1000)::bigint
          END,
          parked_at = NULL,
          unpark_at = NULL,
          parked_by_auto = FALSE,
          updated_at = NOW()
      WHERE status = 'PARKED' AND unpark_at IS NOT NULL AND unpark_at <= NOW()
    `);

    // Основной запрос: JOIN всех нужных таблиц + резолв алиасов блюд.
    // Если блюдо имеет запись в slicer_dish_aliases — подменяем dish_id
    // на primary_dish_id, чтобы фронт агрегировал заказ как "одно блюдо".
    const result = await pool.query(`
      SELECT
        items.suuid AS item_id,
        items.owner AS order_id,
        -- Подмена dish_id: если есть алиас → primary, иначе оригинал
        COALESCE(alias.primary_dish_id::uuid, items.docm2tabl1_ctlg15_uuid__dish) AS dish_id,
        items.docm2tabl1_quantity AS quantity,
        items.docm2tabl1_ordertime AS order_time,
        items.docm2tabl1_cooked AS cooked,
        -- Имя блюда — от primary если есть, иначе от оригинала
        COALESCE(primary_dish.name, dishes.name) AS dish_name,
        tables.ctlg13_tablenumber AS table_number,
        orders.docm2_opentime AS order_open_time,
        -- Данные из slicer_order_state (парковка, статус)
        COALESCE(state.status, 'ACTIVE') AS slicer_status,
        state.quantity_stack,
        state.table_stack,
        state.parked_at,
        state.unpark_at,
        state.effective_created_at,
        state.parked_by_auto,
        state.accumulated_time_ms,
        state.was_parked,
        state.parked_tables,
        -- Состояние разморозки (миграция 016): момент клика ❄️ + snapshot
        -- длительности в секундах. Если defrost_started_at IS NULL — разморозка
        -- не запускалась. Если NOW() < started + duration → в процессе.
        state.defrost_started_at,
        state.defrost_duration_seconds
      FROM docm2tabl1_items items
      INNER JOIN docm2_orders orders ON orders.suuid = items.owner
      INNER JOIN ctlg15_dishes dishes ON dishes.suuid = items.docm2tabl1_ctlg15_uuid__dish
      -- LEFT JOIN: резолв алиаса блюда (если есть)
      LEFT JOIN slicer_dish_aliases alias
        ON alias.alias_dish_id = items.docm2tabl1_ctlg15_uuid__dish::text
      -- LEFT JOIN: данные primary-блюда (имя, приоритет и т.д.)
      LEFT JOIN ctlg15_dishes primary_dish
        ON primary_dish.suuid::text = alias.primary_dish_id
      LEFT JOIN ctlg13_halltables tables ON tables.suuid = orders.docm2_ctlg13_uuid__halltable
      LEFT JOIN slicer_order_state state ON state.order_item_id = items.suuid::text
      WHERE orders.docm2_closed = false
        AND (items.docm2tabl1_cooked IS NULL OR items.docm2tabl1_cooked = false)
        AND COALESCE(state.status, 'ACTIVE') NOT IN ('COMPLETED', 'CANCELLED')
        -- Whitelist цехов: показываем ТОЛЬКО позиции с кухонным складом.
        -- Всё остальное (бар, хозка, битые ссылки) — скрывается.
        AND items.docm2tabl1_ctlg17_uuid__storage IN (${KITCHEN_STORAGE_UUIDS.map((_, i) => `$${i + 1}`).join(', ')})
        -- Блюдо должно иметь хотя бы одну назначенную slicer-категорию.
        -- Если в UI категория не назначена — считаем, что блюдо не проходит
        -- через нарезчика (готовое: рис отварной, пампушки, и т.п.) и не
        -- должно попадать на доску. Проверка идёт по каноническому dish_id
        -- (после резолва алиаса), т.к. категории копируются на primary.
        AND EXISTS (
          SELECT 1 FROM slicer_dish_categories dc
          WHERE dc.dish_id = COALESCE(alias.primary_dish_id, items.docm2tabl1_ctlg15_uuid__dish::text)
        )
        -- Только реальные позиции с количеством > 0. Касса умеет создавать
        -- строки в чеке с qty=0 (обнулена), qty=-1 (возврат) и т.п. — они не
        -- закрываются как готовые, проходят все остальные фильтры и оседают на
        -- доске призраками. Нарезчику резать по 0 порций нечего.
        AND items.docm2tabl1_quantity > 0
      ORDER BY items.docm2tabl1_ordertime ASC
    `, KITCHEN_STORAGE_UUIDS);

    // Маппинг строк БД → объекты Order для фронтенда
    const orders = result.rows.map(row => {
      const tableNumber = row.table_number ? Number(row.table_number) : 0;
      const quantity = Number(row.quantity) || 1;
      const orderTime = row.order_time ? new Date(row.order_time).getTime() : Date.now();
      // Вариант Б (миграция 019): точка отсчёта таймера И сортировки — это
      // `effective_created_at` если он установлен, иначе `ordertime` чужой КDS.
      //   * Новый заказ → effective_created_at = NULL → используем ordertime.
      //   * Ручная парковка/разпарковка → effective_created_at не меняется,
      //     accumulated_time_ms хранит длительность парковки.
      //   * Авто-парковка десерта и её авто-разпарковка → effective_created_at
      //     сдвигается на unpark_at (десерт «как новый»), accumulated_time_ms
      //     обнуляется.
      // Формула elapsed на клиенте: (pivot - created_at) - accumulated_time_ms,
      // где pivot = parked_at если PARKED, иначе now. Минус вместо плюса.
      const effectiveCreatedAt = row.effective_created_at
        ? new Date(row.effective_created_at).getTime()
        : orderTime;

      // Защитный фолбэк для quantity_stack / table_stack.
      // Прежнее `row.table_stack || [[tableNumber]]` ловило только NULL —
      // но slicer_order_state с дефолтами колонок отдаёт `[[]]` / `[1]`
      // (truthy), и реальные столы/количество из docm2tabl1_items терялись
      // после любого INSERT в state, который не трогает эти колонки
      // (например, defrost-start до правки выше). Проверяем «пусто ли по
      // смыслу» (вложенные массивы пусты / сумма qty = 0) и только тогда
      // фолбэчимся на данные JOIN'а.
      const rawTableStack = row.table_stack;
      const tableStackHasRealTables = Array.isArray(rawTableStack)
        && rawTableStack.some((inner: unknown) => Array.isArray(inner) && inner.length > 0);
      const table_stack = tableStackHasRealTables ? rawTableStack : [[tableNumber]];

      const rawQuantityStack = row.quantity_stack;
      const quantityStackTotal = Array.isArray(rawQuantityStack)
        ? rawQuantityStack.reduce((a: number, b: number) => a + (Number(b) || 0), 0)
        : 0;
      const quantity_stack = quantityStackTotal > 0 ? rawQuantityStack : [quantity];

      return {
        id: row.item_id,
        dish_id: row.dish_id,
        quantity_stack,
        table_stack,
        created_at: effectiveCreatedAt,
        updated_at: row.parked_at ? new Date(row.parked_at).getTime() : effectiveCreatedAt,
        status: row.slicer_status,
        parked_by_auto: row.parked_by_auto === true,
        parked_at: row.parked_at ? new Date(row.parked_at).getTime() : undefined,
        unpark_at: row.unpark_at ? new Date(row.unpark_at).getTime() : undefined,
        accumulated_time_ms: row.accumulated_time_ms ? Number(row.accumulated_time_ms) : 0,
        was_parked: row.was_parked || false,
        parked_tables: row.parked_tables || [],
        // Разморозка (миграция 016): null/undefined = не запускалась.
        defrost_started_at: row.defrost_started_at
          ? new Date(row.defrost_started_at).getTime()
          : null,
        defrost_duration_seconds: row.defrost_duration_seconds != null
          ? Number(row.defrost_duration_seconds)
          : null
      };
    });

    res.json(orders);
  } catch (err) {
    console.error('[Orders] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения заказов' });
  }
});

/**
 * POST /api/orders/:id/complete — Завершить заказ (отметить как приготовленный).
 * Body: { dishId, dishName, totalQuantity, prepTimeMs, wasParked, snapshot, consumedIngredients }
 */
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { dishId, dishName, totalQuantity, prepTimeMs, wasParked, snapshot, consumedIngredients } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Отметить завершение нарезчиком в нашей теневой таблице.
      //    docm2tabl1_items.docm2tabl1_cooked НЕ трогаем — это поле основной KDS
      //    (раздача / пасс), чтобы нажатие нарезчиком не путало другие панели.
      //    finished_at = NOW() нужен для замера времени готовки повара
      //    (docm2tabl1_cooktime - finished_at).
      await client.query(
        `INSERT INTO slicer_order_state (order_item_id, status, finished_at)
         VALUES ($1, 'COMPLETED', NOW())
         ON CONFLICT (order_item_id) DO UPDATE SET
           status = 'COMPLETED',
           finished_at = NOW(),
           updated_at = NOW()`,
        [id]
      );

      // 3. Создать запись в истории
      const historyResult = await client.query(
        `INSERT INTO slicer_order_history (dish_id, dish_name, total_quantity, prep_time_ms, was_parked, snapshot, consumed_ingredients)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [dishId, dishName, totalQuantity, prepTimeMs, wasParked || false, JSON.stringify(snapshot), JSON.stringify(consumedIngredients)]
      );
      const historyId = historyResult.rows[0].id;

      // 4. Записать расход ингредиентов (для SQL-агрегации в отчётах)
      if (Array.isArray(consumedIngredients)) {
        for (const ing of consumedIngredients) {
          await client.query(
            `INSERT INTO slicer_ingredient_consumption (order_history_id, ingredient_id, ingredient_name, unit_type, quantity, weight_grams)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [historyId, ing.id, ing.name, ing.unitType, ing.quantity, ing.weightGrams]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ completed: true, historyId });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Orders] Ошибка complete:', err);
    res.status(500).json({ error: 'Ошибка завершения заказа' });
  }
});

/**
 * POST /api/orders/:id/partial-complete — Частичное завершение заказа.
 * Body: то же что complete + quantityToComplete
 */
router.post('/:id/partial-complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { dishId, dishName, quantityToComplete, prepTimeMs, wasParked, snapshot, consumedIngredients, remainingQuantityStack, remainingTableStack } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Обновить slicer_order_state с уменьшенным quantity_stack
      await client.query(
        `INSERT INTO slicer_order_state (order_item_id, quantity_stack, table_stack)
         VALUES ($1, $2, $3)
         ON CONFLICT (order_item_id) DO UPDATE SET
           quantity_stack = $2, table_stack = $3, updated_at = NOW()`,
        [id, JSON.stringify(remainingQuantityStack), JSON.stringify(remainingTableStack)]
      );

      // Создать запись в истории (частичную)
      const historyResult = await client.query(
        `INSERT INTO slicer_order_history (dish_id, dish_name, total_quantity, prep_time_ms, was_parked, snapshot, consumed_ingredients)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [dishId, dishName + ' (Partial)', quantityToComplete, prepTimeMs, wasParked || false, JSON.stringify(snapshot), JSON.stringify(consumedIngredients)]
      );
      const historyId = historyResult.rows[0].id;

      // Записать расход ингредиентов
      if (Array.isArray(consumedIngredients)) {
        for (const ing of consumedIngredients) {
          await client.query(
            `INSERT INTO slicer_ingredient_consumption (order_history_id, ingredient_id, ingredient_name, unit_type, quantity, weight_grams)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [historyId, ing.id, ing.name, ing.unitType, ing.quantity, ing.weightGrams]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ completed: true, historyId });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Orders] Ошибка partial-complete:', err);
    res.status(500).json({ error: 'Ошибка частичного завершения' });
  }
});

/** POST /api/orders/:id/cancel — Отмена заказа */
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(
      `INSERT INTO slicer_order_state (order_item_id, status) VALUES ($1, 'CANCELLED')
       ON CONFLICT (order_item_id) DO UPDATE SET status = 'CANCELLED', updated_at = NOW()`,
      [id]
    );
    res.json({ cancelled: true });
  } catch (err) {
    console.error('[Orders] Ошибка cancel:', err);
    res.status(500).json({ error: 'Ошибка отмены заказа' });
  }
});

/** POST /api/orders/:id/park — Ручная парковка стола
 *
 * Вариант Б (миграция 019):
 *   - `parked_by_auto = FALSE` — маркируем как ручную парковку.
 *   - `accumulated_time_ms` НЕ трогаем. Теперь смысл колонки — «общее время
 *     парковок»; накопление происходит при /unpark, а не при /park.
 *   - `effective_created_at` НЕ трогаем. При ручном unpark заказ вернётся на
 *     историческое место в очереди (по ordertime).
 *
 * При парковке сбрасываем defrost_started_at/duration: парковка доминирует над
 * разморозкой. Если заказ отложили на час-два — прошлая разморозка уже не
 * актуальна, при снятии с парковки нарезчик запустит её заново.
 *
 * `accumulatedTimeMs` из body принимается для обратной совместимости с клиентом,
 * но используется только при INSERT (новая строка state). На UPDATE уже
 * существующего accumulated игнорируем — его обновляет /unpark.
 */
router.post('/:id/park', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantityStack, tableStack, parkedTables, unparkAt, accumulatedTimeMs } = req.body;

    await pool.query(
      `INSERT INTO slicer_order_state (order_item_id, status, quantity_stack, table_stack, parked_at, unpark_at, accumulated_time_ms, was_parked, parked_tables, parked_by_auto, defrost_started_at, defrost_duration_seconds)
       VALUES ($1, 'PARKED', $2, $3, NOW(), $4, $5, true, $6, FALSE, NULL, NULL)
       ON CONFLICT (order_item_id) DO UPDATE SET
         status = 'PARKED',
         quantity_stack = $2,
         table_stack = $3,
         parked_at = NOW(),
         unpark_at = $4,
         -- accumulated_time_ms НЕ обновляем: накопление при /unpark.
         was_parked = true,
         parked_tables = $6,
         parked_by_auto = FALSE,
         defrost_started_at = NULL,
         defrost_duration_seconds = NULL,
         updated_at = NOW()`,
      [
        id,
        JSON.stringify(quantityStack),
        JSON.stringify(tableStack),
        unparkAt ? new Date(unparkAt) : null,
        accumulatedTimeMs || 0,
        JSON.stringify(parkedTables || [])
      ]
    );
    res.json({ parked: true });
  } catch (err) {
    console.error('[Orders] Ошибка park:', err);
    res.status(500).json({ error: 'Ошибка парковки' });
  }
});

/**
 * POST /api/orders/:id/unpark — Снять с парковки (ручной клик).
 *
 * Вариант Б (миграция 019) — две ветки:
 *
 *   1) Ручная парковка (parked_by_auto=FALSE):
 *      accumulated_time_ms += (NOW() - parked_at)  — общее время парковок.
 *      effective_created_at не трогаем. Заказ возвращается на историческое
 *      место в очереди (сортировка по ordertime).
 *
 *   2) Автопарковка десерта (parked_by_auto=TRUE), нарезчик жмёт «Вернуть»
 *      раньше таймера (гость сказал «несите уже»):
 *      accumulated_time_ms = 0
 *      effective_created_at = NOW() — десерт «как новый» для кухни, встаёт
 *      в конец очереди, таймер с нуля.
 *
 * CASE использует parked_by_auto на момент UPDATE, поэтому не ломается если
 * endpoint вызвали для уже ACTIVE строки (CASE просто ничего не посчитает,
 * потому что WHERE не матчит — но для safety считаем через COALESCE от NULL
 * parked_at: 0 миллисекунд).
 */
router.post('/:id/unpark', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE slicer_order_state SET
        status = 'ACTIVE',
        effective_created_at = CASE
          WHEN parked_by_auto THEN NOW()
          ELSE effective_created_at
        END,
        accumulated_time_ms = CASE
          WHEN parked_by_auto THEN 0
          WHEN parked_at IS NULL THEN COALESCE(accumulated_time_ms, 0)
          ELSE COALESCE(accumulated_time_ms, 0) +
               (EXTRACT(EPOCH FROM (NOW() - parked_at)) * 1000)::bigint
        END,
        parked_at = NULL,
        unpark_at = NULL,
        parked_by_auto = FALSE,
        updated_at = NOW()
       WHERE order_item_id = $1`,
      [id]
    );
    res.json({ unparked: true });
  } catch (err) {
    console.error('[Orders] Ошибка unpark:', err);
    res.status(500).json({ error: 'Ошибка снятия с парковки' });
  }
});

/**
 * POST /api/orders/:id/restore — Вернуть позицию в активные из истории.
 *
 * Используется при клике «Вернуть» в разделе Истории нарезчика. Нужен чтобы
 * перезаписать slicer_order_state состоянием, которое хочет увидеть
 * пользователь (то что было в снапшоте + то что сейчас на доске, если
 * параллельно уже висел остаток от partial-complete).
 *
 * Body: `{ quantityStack: number[], tableStack: number[][] }` — финальные
 * значения, которые должны оказаться в slicer_order_state. Рассчитываются
 * на фронте: если позиция уже висит активной (остаток partial) — передают
 * сумму существующего и снапшота; если нет — сам снапшот.
 *
 * Сбрасывает status в ACTIVE, обнуляет parked_at/unpark_at/finished_at —
 * позиция становится «живой» заново, нарезчик может её снова завершать.
 *
 * Возможно улучшение: хранить prev_state в slicer_order_history при каждом
 * partial/complete, тогда restore будет точно откатывать без расчётов на
 * фронте. Пока фронт отвечает за математику.
 */
router.post('/:id/restore', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantityStack, tableStack } = req.body;
    if (!Array.isArray(quantityStack) || !Array.isArray(tableStack)) {
      res.status(400).json({ error: 'quantityStack и tableStack должны быть массивами' });
      return;
    }

    await pool.query(
      `INSERT INTO slicer_order_state
         (order_item_id, status, quantity_stack, table_stack, finished_at, parked_at, unpark_at, was_parked, defrost_started_at, defrost_duration_seconds, accumulated_time_ms, effective_created_at, parked_by_auto)
       VALUES ($1, 'ACTIVE', $2, $3, NULL, NULL, NULL, false, NULL, NULL, 0, NULL, FALSE)
       ON CONFLICT (order_item_id) DO UPDATE SET
         status                   = 'ACTIVE',
         quantity_stack           = $2,
         table_stack              = $3,
         finished_at              = NULL,
         parked_at                = NULL,
         unpark_at                = NULL,
         defrost_started_at       = NULL,
         defrost_duration_seconds = NULL,
         -- Восстановление = чистый лист: сбрасываем накопленное время парковок
         -- и override для сортировки. Таймер считается от ordertime с нуля
         -- накопленного, что для возврата из истории может быть не 0 мин.
         -- Это норма — нарезчик видит сколько прошло с момента заказа.
         accumulated_time_ms      = 0,
         effective_created_at     = NULL,
         parked_by_auto           = FALSE,
         updated_at               = NOW()`,
      [id, JSON.stringify(quantityStack), JSON.stringify(tableStack)]
    );
    res.json({ restored: true });
  } catch (err) {
    console.error('[Orders] Ошибка restore:', err);
    res.status(500).json({ error: 'Ошибка восстановления заказа' });
  }
});

/** POST /api/orders/:id/merge — Объединить стеки */
router.post('/:id/merge', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quantityStack, tableStack } = req.body;

    await pool.query(
      `INSERT INTO slicer_order_state (order_item_id, quantity_stack, table_stack)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_item_id) DO UPDATE SET
         quantity_stack = $2, table_stack = $3, updated_at = NOW()`,
      [id, JSON.stringify(quantityStack), JSON.stringify(tableStack)]
    );
    res.json({ merged: true });
  } catch (err) {
    console.error('[Orders] Ошибка merge:', err);
    res.status(500).json({ error: 'Ошибка объединения' });
  }
});

/**
 * POST /api/orders/:id/defrost-start — Запустить разморозку позиции.
 *
 * Body: `{ sourceOrderItemIds?: string[] }` — если указан, апдейтим сразу все
 * order_item_id этого списка в одной транзакции. Нужно для Smart Wave: один
 * виртуальный заказ = несколько source items (стек 1+1+1 по разным столам).
 * Все получают один и тот же defrost_started_at → состояние консистентно,
 * polling выдаст единую мини-карточку.
 *
 * Если sourceOrderItemIds не переданы — работаем с одним :id (стандартный режим).
 *
 * Длительность берётся per-dish из slicer_dish_defrost.defrost_duration_minutes
 * (миграция 020, резолв alias→primary) в момент клика и сохраняется снимком
 * (defrost_duration_seconds). Изменение настройки блюда после старта не сбивает
 * таймер уже запущенных разморозок. Фолбэк 15 мин если записи нет.
 *
 * UPSERT важен: у позиции может ещё не быть строки в slicer_order_state
 * (нарезчик не трогал заказ до клика по ❄️).
 */
router.post('/:id/defrost-start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { sourceOrderItemIds } = req.body as { sourceOrderItemIds?: string[] };

    const ids = Array.isArray(sourceOrderItemIds) && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [id];

    // Длительность — per-dish (миграция 020). Резолвим в SELECT через alias→primary,
    // COALESCE на 15 минут если записи в slicer_dish_defrost нет (хотя если у
    // блюда requires_defrost=false, фронт ❄️ не покажет — всё равно защитимся).
    // Smart Wave гарантирует одинаковое блюдо на всех items группы, поэтому
    // duration_seconds получится одинаковым для всей транзакции — мини-карточка
    // в DefrostRow останется консистентной.
    const client = await pool.connect();
    let firstDurationSec = 15 * 60;
    try {
      await client.query('BEGIN');
      // Важно: при INSERT свежей строки нельзя полагаться на DEFAULT'ы для
      // quantity_stack/table_stack — они `'[1]'` / `'[[]]'` и перетрут реальные
      // количество/столы, которые GET /api/orders собирал JOIN'ом из
      // docm2tabl1_items + ctlg13_halltables. После такого INSERT'а карточка
      // на доске показывала «столы: 0 + 0» и нулевое количество.
      //
      // Решение: подтягиваем реальные qty+tableNumber из JOIN'а и кладём их
      // в новую строку. На UPDATE (строка уже была от park/partial-complete)
      // эти колонки не трогаем — там актуальные значения нарезчика.
      for (const itemId of ids) {
        const upsertRes = await client.query(
          `INSERT INTO slicer_order_state
             (order_item_id, status, quantity_stack, table_stack, defrost_started_at, defrost_duration_seconds)
           SELECT
             items.suuid::text,
             'ACTIVE',
             jsonb_build_array(items.docm2tabl1_quantity),
             CASE
               WHEN tables.ctlg13_tablenumber IS NOT NULL
                 THEN jsonb_build_array(jsonb_build_array(tables.ctlg13_tablenumber))
               ELSE '[[]]'::jsonb
             END,
             NOW(),
             -- Per-dish длительность: alias→primary→slicer_dish_defrost.
             -- Фолбэк 15 мин если записи нет (защита на случай рассинхрона UI).
             COALESCE(dd.defrost_duration_minutes, 15) * 60
           FROM docm2tabl1_items items
           LEFT JOIN docm2_orders orders ON orders.suuid = items.owner
           LEFT JOIN ctlg13_halltables tables ON tables.suuid = orders.docm2_ctlg13_uuid__halltable
           LEFT JOIN slicer_dish_aliases alias
             ON alias.alias_dish_id = items.docm2tabl1_ctlg15_uuid__dish::text
           LEFT JOIN slicer_dish_defrost dd
             ON dd.dish_id = COALESCE(alias.primary_dish_id, items.docm2tabl1_ctlg15_uuid__dish::text)
           WHERE items.suuid::text = $1
           ON CONFLICT (order_item_id) DO UPDATE SET
             defrost_started_at       = EXCLUDED.defrost_started_at,
             defrost_duration_seconds = EXCLUDED.defrost_duration_seconds,
             updated_at               = NOW()
           RETURNING defrost_duration_seconds`,
          [itemId]
        );
        // Сохраняем первый вычисленный duration, чтобы отдать его клиенту.
        const returnedSec = upsertRes.rows[0]?.defrost_duration_seconds;
        if (returnedSec != null) firstDurationSec = Number(returnedSec);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ started: true, durationSeconds: firstDurationSec, items: ids.length });
  } catch (err) {
    console.error('[Orders] Ошибка defrost-start:', err);
    res.status(500).json({ error: 'Ошибка запуска разморозки' });
  }
});

/**
 * POST /api/orders/:id/defrost-cancel — Отменить запущенную разморозку.
 *
 * Сбрасывает defrost_started_at/duration → карточка возвращается в очередь
 * в исходном виде (с восстановленным ULTRA, если он был). Остальные поля
 * состояния (парковка, стек, finished_at) не трогаем.
 *
 * Body: `{ sourceOrderItemIds?: string[] }` — массив реальных items для
 * Smart Wave. Без него — один :id.
 */
router.post('/:id/defrost-cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { sourceOrderItemIds } = req.body as { sourceOrderItemIds?: string[] };
    const ids = Array.isArray(sourceOrderItemIds) && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [id];

    await pool.query(
      `UPDATE slicer_order_state
         SET defrost_started_at = NULL,
             defrost_duration_seconds = NULL,
             updated_at = NOW()
       WHERE order_item_id = ANY($1::text[])`,
      [ids]
    );
    res.json({ cancelled: true, items: ids.length });
  } catch (err) {
    console.error('[Orders] Ошибка defrost-cancel:', err);
    res.status(500).json({ error: 'Ошибка отмены разморозки' });
  }
});

/**
 * POST /api/orders/:id/defrost-complete — Вручную подтвердить готовность («Разморозилась»).
 *
 * Если нарезчик видит что рыба оттаяла раньше таймера — жмёт кнопку в модалке.
 * Сдвигаем defrost_started_at в прошлое на duration+1 секунду:
 *   NOW() - (duration+1)s → NOW() - started_at = duration + 1 → таймер истёк.
 * Отдельную колонку «вручную завершено» не заводим — состояние однозначно
 * выражается этой парой полей (см. комментарий к миграции 016).
 *
 * ULTRA-приоритет сохраняется после разморозки — раз блюдо ULTRA, оно остаётся
 * ULTRA. smartQueue смотрит ТОЛЬКО на dish.priority_flag, флаг разморозки не
 * влияет (см. fix 949ecfd).
 */
router.post('/:id/defrost-complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { sourceOrderItemIds } = req.body as { sourceOrderItemIds?: string[] };
    const ids = Array.isArray(sourceOrderItemIds) && sourceOrderItemIds.length > 0
      ? sourceOrderItemIds
      : [id];

    // Бэкдейтим started_at на (duration+1) секунд назад. COALESCE на случай
    // если duration_seconds почему-то NULL (старые строки) — берём 0, тогда
    // started_at=NOW() и таймер сразу считается истёкшим.
    await pool.query(
      `UPDATE slicer_order_state
         SET defrost_started_at = NOW() - ((COALESCE(defrost_duration_seconds, 0) + 1) || ' seconds')::interval,
             updated_at = NOW()
       WHERE order_item_id = ANY($1::text[])
         AND defrost_started_at IS NOT NULL`,
      [ids]
    );
    res.json({ completed: true, items: ids.length });
  } catch (err) {
    console.error('[Orders] Ошибка defrost-complete:', err);
    res.status(500).json({ error: 'Ошибка подтверждения разморозки' });
  }
});

export default router;
