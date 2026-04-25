/**
 * Маршруты для управления стоп-листом ингредиентов и блюд.
 *
 * Архитектура:
 * - slicer_ingredients.is_stopped    — состояние стопа ингредиента (источник правды)
 * - slicer_dish_stoplist             — актуальный стоп-лист блюд модуля:
 *     MANUAL  — поставлен пользователем вручную (не удаляется каскадом)
 *     CASCADE — автоматически от стопнутого ингредиента (удаляется при снятии)
 * - slicer_stop_history              — лог завершённых стопов для Dashboard (duration_ms)
 *
 * Каскадная логика перенесена с фронтенда на backend: после любого изменения
 * стопа ингредиента вызывается recalculateCascadeStops(), которая в той же
 * транзакции приводит slicer_dish_stoplist к актуальному состоянию.
 */
import { Router, Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../config/db';
import { pushDishStop, pushDishUnstop, pushDishUnstopAll } from '../services/kdsStoplistSync';

const router = Router();

/**
 * Пересчёт каскадных стопов блюд после изменения состояния ингредиентов.
 *
 * Работает строго внутри переданного клиента/транзакции. Приводит таблицу
 * slicer_dish_stoplist к актуальному целевому состоянию:
 *
 * 1. Вычисляет целевой набор блюд, которые ДОЛЖНЫ быть на каскадном стопе —
 *    это блюда, в рецепте которых есть ингредиент, удовлетворяющий условию
 *    (сам на стопе, ИЛИ его parent на стопе). Целевой набор расширяется на
 *    блюда-алиасы, указывающие на затронутые primary-блюда.
 *
 * 2. Читает текущие CASCADE-строки.
 *
 * 3. Для строк, которые больше не должны быть каскадными (ингредиент вернулся),
 *    записывает в slicer_stop_history завершение стопа с duration_ms и удаляет их.
 *
 * 4. Для блюд, которые должны быть каскадными, но ещё не в таблице —
 *    делает INSERT с `ON CONFLICT DO NOTHING`. Это защищает MANUAL-стопы от
 *    перезаписи (если блюдо остановлено вручную, каскад не лезет).
 *
 * Ручные стопы (MANUAL) этой функцией не трогаются никогда.
 */
/**
 * Актор действия — юзер, инициировавший toggle. Передаётся от route'а
 * в recalculateCascadeStops, чтобы каскадные стопы блюд унаследовали
 * того же автора (actor_source='cascade'), что и triggering-ingredient toggle.
 * Если авторизация не передана (backward compat с ранним вызовом до ввода PIN),
 * все поля undefined → пишем NULL в БД.
 */
interface Actor {
  uuid?: string | null;
  name?: string | null;
}

/**
 * Резолвит alias-группу блюда: массив dish_id, включающий primary
 * и все его алиасы. Используется в ручном dish toggle, чтобы стоп/снятие
 * распространялось на всю группу синхронно — алиасы режут одинаково по
 * рецепту (Д184 = 184 для нарезчика), поэтому должны быть в одном состоянии.
 *
 * Случаи:
 * - dishId это primary → группа = [primary, все его aliases]
 * - dishId это alias → находим primary → группа = [primary, все его aliases]
 * - dishId без алиасов → группа = [dishId]
 *
 * Каскадная логика (recalculateCascadeStops) уже сама учитывает алиасы
 * через UNION с slicer_dish_aliases — этот helper нужен только для ручного
 * dish toggle, где раньше работали только с одним dish_id.
 */
async function resolveAliasGroup(client: PoolClient, dishId: string): Promise<string[]> {
  // Шаг 1: найти primary. Если dishId — алиас, primary берём из таблицы.
  // Если нет — primary это сам dishId.
  const primaryRes = await client.query(
    `SELECT primary_dish_id FROM slicer_dish_aliases WHERE alias_dish_id = $1`,
    [dishId]
  );
  const primaryId: string = primaryRes.rows.length > 0
    ? primaryRes.rows[0].primary_dish_id
    : dishId;

  // Шаг 2: все алиасы primary-блюда (включая dishId если он сам был алиасом).
  const aliasRes = await client.query(
    `SELECT alias_dish_id FROM slicer_dish_aliases WHERE primary_dish_id = $1`,
    [primaryId]
  );
  const aliasIds: string[] = aliasRes.rows.map(r => r.alias_dish_id);

  // Шаг 3: дедупликация (на случай битых данных). Primary всегда первым.
  return Array.from(new Set([primaryId, ...aliasIds]));
}

async function recalculateCascadeStops(
  client: PoolClient,
  actor: Actor = {}
): Promise<void> {
  // 1. Целевой набор: {dish_id, blocking_ingredient_id, blocking_ingredient_name}
  //    Учитываем иерархию (parent on stop → child treated as stopped) и алиасы блюд.
  const targetRes = await client.query(`
    WITH stopped_ingredient_ids AS (
      -- Сам ингредиент на стопе
      SELECT id, name FROM slicer_ingredients WHERE is_stopped = true
      UNION
      -- Родитель на стопе → ребёнок тоже считается стопнутым
      SELECT child.id, child.name
      FROM slicer_ingredients child
      JOIN slicer_ingredients parent ON parent.id = child.parent_id
      WHERE parent.is_stopped = true
    ),
    affected_primaries AS (
      -- Одно блюдо → один «блокирующий» ингредиент (берём первый по имени
      -- для детерминизма при множественных попаданиях).
      SELECT DISTINCT ON (r.dish_id)
        r.dish_id,
        si.id   AS blocking_ingredient_id,
        si.name AS blocking_ingredient_name
      FROM slicer_recipes r
      JOIN stopped_ingredient_ids si ON si.id = r.ingredient_id
      ORDER BY r.dish_id, si.name
    ),
    with_aliases AS (
      -- Сами primary-блюда
      SELECT dish_id, blocking_ingredient_id, blocking_ingredient_name
      FROM affected_primaries
      UNION ALL
      -- Блюда-алиасы, указывающие на затронутые primary
      SELECT a.alias_dish_id AS dish_id, ap.blocking_ingredient_id, ap.blocking_ingredient_name
      FROM affected_primaries ap
      JOIN slicer_dish_aliases a ON a.primary_dish_id = ap.dish_id
    )
    SELECT DISTINCT ON (dish_id) dish_id, blocking_ingredient_id, blocking_ingredient_name
    FROM with_aliases
    ORDER BY dish_id
  `);

  const targetMap = new Map<
    string,
    { blockingId: string; blockingName: string }
  >();
  for (const row of targetRes.rows) {
    targetMap.set(row.dish_id, {
      blockingId: row.blocking_ingredient_id,
      blockingName: row.blocking_ingredient_name,
    });
  }

  // 2. Текущие CASCADE-строки + имя блюда из чужой ctlg15_dishes.
  //    Имя нужно чтобы в slicer_stop_history писать реальное название блюда
  //    (раньше туда попадал info.reason = "Missing: <ingredient>" — в Dashboard
  //    выглядело как ингредиент, не как блюдо). Для alias-блюд берём имя alias-а:
  //    то, что видит нарезчик на доске (primary-имя уже резолвится отдельно через
  //    /api/orders; в истории логичнее хранить фактический dish_id и его имя).
  const existingRes = await client.query(
    `SELECT s.dish_id, s.stopped_at, s.reason, s.cascade_ingredient_id, s.rgst3_row_suuid,
            s.stopped_by_uuid, s.stopped_by_name, s.actor_source,
            COALESCE(d.name, 'Unknown dish') AS dish_name
       FROM slicer_dish_stoplist s
       LEFT JOIN ctlg15_dishes d ON d.suuid::text = s.dish_id
       WHERE s.stop_type = 'CASCADE'`
  );
  const existingCascade = new Map<
    string,
    {
      stoppedAt: Date;
      reason: string | null;
      blockingId: string | null;
      rgst3RowSuuid: string | null;
      dishName: string;
      stoppedByUuid: string | null;
      stoppedByName: string | null;
      actorSource: string | null;
    }
  >();
  for (const row of existingRes.rows) {
    existingCascade.set(row.dish_id, {
      stoppedAt: row.stopped_at,
      reason: row.reason,
      blockingId: row.cascade_ingredient_id,
      rgst3RowSuuid: row.rgst3_row_suuid,
      dishName: row.dish_name,
      stoppedByUuid: row.stopped_by_uuid,
      stoppedByName: row.stopped_by_name,
      actorSource: row.actor_source,
    });
  }

  // 3. Удаляем каскадные стопы, которые больше не нужны → пишем историю
  //    + откатываем зеркальную строку из rgst3_dishstoplist (если sync включён)
  const now = new Date();
  for (const [dishId, info] of existingCascade) {
    if (!targetMap.has(dishId)) {
      const durationMs = now.getTime() - new Date(info.stoppedAt).getTime();
      // resumed_by_* = текущий actor (тот кто толкнул каскад наружу —
      // типично это тот же юзер, что снял стоп с ингредиента-родителя).
      // stopped_by_* — копируем с строки slicer_dish_stoplist (актор исходной
      // постановки каскада, может быть другим юзером или тем же).
      await client.query(
        `INSERT INTO slicer_stop_history
          (target_type, target_id, target_name, stopped_at, resumed_at, reason, duration_ms,
           stopped_by_uuid, stopped_by_name,
           resumed_by_uuid, resumed_by_name,
           actor_source)
         VALUES ('dish', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          dishId,
          info.dishName,                 // target_name = реальное имя блюда
          info.stoppedAt,
          now,
          info.reason || 'Cascade',      // reason = "Missing: <ingredient>" или 'Cascade'
          durationMs,
          info.stoppedByUuid,
          info.stoppedByName,
          actor.uuid ?? null,
          actor.name ?? null,
          info.actorSource || 'cascade',
        ]
      );
      // Sync: убираем нашу строку из чужой таблицы (no-op если sync выключен)
      await pushDishUnstop(client, info.rgst3RowSuuid);
      await client.query(
        `DELETE FROM slicer_dish_stoplist WHERE dish_id = $1 AND stop_type = 'CASCADE'`,
        [dishId]
      );
    }
  }

  // 4. Добавляем новые каскадные стопы. ON CONFLICT DO NOTHING — защита от
  //    перезаписи MANUAL-строки: если блюдо уже остановлено вручную, каскад
  //    молча не трогает его. Sync с rgst3 — только для реально вставленных строк.
  for (const [dishId, target] of targetMap) {
    if (!existingCascade.has(dishId)) {
      const reason = `Missing: ${target.blockingName}`;
      // Sync ДО вставки в slicer_dish_stoplist — если rgst3 INSERT упадёт,
      // транзакция откатит всё. Если sync выключен — pushDishStop вернёт null.
      // Actor пробрасывается чтобы responsible/inserter в rgst3 указывали на
      // реального юзера, инициировавшего toggle ингредиента-родителя.
      const rgst3Suuid = await pushDishStop(client, dishId, reason, actor);
      const insertRes = await client.query(
        `INSERT INTO slicer_dish_stoplist
          (dish_id, stop_type, reason, cascade_ingredient_id, rgst3_row_suuid,
           stopped_by_uuid, stopped_by_name, actor_source)
         VALUES ($1, 'CASCADE', $2, $3, $4, $5, $6, 'cascade')
         ON CONFLICT (dish_id) DO NOTHING
         RETURNING dish_id`,
        [dishId, reason, target.blockingId, rgst3Suuid, actor.uuid ?? null, actor.name ?? null]
      );
      // Если ON CONFLICT сработал (блюдо уже было MANUAL), мы зря записали
      // в rgst3 — откатываем.
      if (insertRes.rows.length === 0 && rgst3Suuid) {
        await pushDishUnstop(client, rgst3Suuid);
      }
    }
  }
}

/**
 * POST /api/stoplist/toggle — Переключить стоп-лист ингредиента или блюда.
 * Body: { targetId, targetType: 'ingredient'|'dish', reason? }
 *
 * Для ингредиентов: обновляет is_stopped в slicer_ingredients + каскадный пересчёт.
 * Для блюд: UPSERT MANUAL-строки в slicer_dish_stoplist.
 * При снятии со стопа — всегда записывается в slicer_stop_history с duration_ms.
 */
router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const { targetId, targetType, reason, actorUuid, actorName } = req.body;

    if (!targetId || !targetType) {
      res.status(400).json({ error: 'targetId и targetType обязательны' });
      return;
    }

    // Актор действия — залогиненный юзер (из frontend useAuth). Приходит
    // опционально для обратной совместимости: если кто-то дёрнет endpoint
    // напрямую без auth, запись просто получит actor=NULL вместо падения.
    const actor: Actor = {
      uuid: typeof actorUuid === 'string' && actorUuid.length > 0 ? actorUuid : null,
      name: typeof actorName === 'string' && actorName.trim().length > 0 ? actorName.trim() : null,
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (targetType === 'ingredient') {
        const current = await client.query(
          `SELECT is_stopped, stop_reason, stop_timestamp, name,
                  stopped_by_uuid, stopped_by_name
             FROM slicer_ingredients WHERE id = $1`,
          [targetId]
        );
        if (current.rows.length === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ error: 'Ингредиент не найден' });
          return;
        }

        const ing = current.rows[0];
        const isStopping = !ing.is_stopped;

        // Снятие со стопа → пишем историю по ингредиенту.
        // stopped_by_* берём из текущей строки (кто изначально поставил),
        // resumed_by_* — из actor'а текущего toggle (тот кто снимает).
        if (!isStopping && ing.is_stopped && ing.stop_timestamp) {
          const now = new Date();
          const stoppedAt = new Date(ing.stop_timestamp);
          const durationMs = now.getTime() - stoppedAt.getTime();

          await client.query(
            `INSERT INTO slicer_stop_history
              (target_type, target_id, target_name, stopped_at, resumed_at, reason, duration_ms,
               stopped_by_uuid, stopped_by_name,
               resumed_by_uuid, resumed_by_name,
               actor_source)
             VALUES ('ingredient', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'slicer')`,
            [
              targetId,
              ing.name,
              ing.stop_timestamp,
              now,
              ing.stop_reason || 'Unknown',
              durationMs,
              ing.stopped_by_uuid,
              ing.stopped_by_name,
              actor.uuid,
              actor.name,
            ]
          );
        }

        // Обновляем состояние ингредиента. При постановке — записываем актора;
        // при снятии — очищаем все stop-поля (stopped_by_* тоже, они больше не релевантны).
        await client.query(
          `UPDATE slicer_ingredients SET
            is_stopped = $1,
            stop_reason = $2,
            stop_timestamp = $3,
            stopped_by_uuid = $4,
            stopped_by_name = $5,
            updated_at = NOW()
           WHERE id = $6`,
          [
            isStopping,
            isStopping ? reason || null : null,
            isStopping ? new Date() : null,
            isStopping ? actor.uuid : null,
            isStopping ? actor.name : null,
            targetId,
          ]
        );

        // Пересчёт каскадных стопов — актор передаётся чтобы новые каскадные
        // строки и закрываемые history-строки унаследовали того же юзера.
        await recalculateCascadeStops(client, actor);

        await client.query('COMMIT');
        res.json({ toggled: true, is_stopped: isStopping });
        return;
      }

      if (targetType === 'dish') {
        // Alias-группа: блюдо + все его варианты (Д184 + 184 — режут одинаково).
        // Стоп/снятие применяется ко ВСЕЙ группе синхронно. Если у блюда нет
        // алиасов — группа из одного элемента, поведение как раньше.
        const aliasGroup = await resolveAliasGroup(client, targetId);

        // Состояние КЛИКНУТОГО блюда (targetId) определяет намерение: stop vs unstop.
        // UNION двух источников чтобы корректно обработать стопы из основной KDS:
        //  1. slicer_dish_stoplist — наш модуль
        //  2. rgst3_dishstoplist в открытой смене — основная KDS
        const sliceRes = await client.query(
          `SELECT 1 FROM slicer_dish_stoplist WHERE dish_id = $1 LIMIT 1`,
          [targetId]
        );
        const rgstRes = await client.query(
          `SELECT 1 FROM rgst3_dishstoplist r
             JOIN ctlg14_shifts s ON s.suuid = r.rgst3_ctlg14_uuid__shift
             WHERE r.rgst3_ctlg15_uuid__dish::text = $1
               AND s.ctlg14_closed = false
             LIMIT 1`,
          [targetId]
        );
        const isCurrentlyStopped = sliceRes.rows.length > 0 || rgstRes.rows.length > 0;
        const isStopping = !isCurrentlyStopped;
        const dishName: string = req.body.dishName || 'Unknown';

        if (isStopping) {
          // STOP всей alias-группы. Для каждого блюда:
          //  - если ещё не стопнуто (не в slicer_dish_stoplist) → INSERT + push в rgst3
          //  - если уже стопнуто → пропускаем (избегаем дублей и orphan-rgst3-строк)
          // ON CONFLICT DO NOTHING — защита от race-condition на уровне БД.
          for (const id of aliasGroup) {
            const exists = await client.query(
              `SELECT 1 FROM slicer_dish_stoplist WHERE dish_id = $1 LIMIT 1`,
              [id]
            );
            if (exists.rows.length > 0) continue;

            // Sync ДО вставки в slicer — если rgst3 INSERT упадёт, транзакция
            // откатит всё. Если sync выключен → null.
            const rgst3Suuid = await pushDishStop(client, id, reason || 'Manual', actor);
            await client.query(
              `INSERT INTO slicer_dish_stoplist
                (dish_id, stop_type, reason, stopped_at, cascade_ingredient_id, rgst3_row_suuid,
                 stopped_by_uuid, stopped_by_name, actor_source)
               VALUES ($1, 'MANUAL', $2, NOW(), NULL, $3, $4, $5, 'slicer')
               ON CONFLICT (dish_id) DO NOTHING`,
              [id, reason || 'Manual', rgst3Suuid, actor.uuid, actor.name]
            );
          }

          await client.query('COMMIT');
          res.json({ toggled: true, is_stopped: true, alias_group_size: aliasGroup.length });
          return;
        }

        // UNSTOP всей alias-группы.
        // Политика «модуль — мастер стоп-листа»: снятие в нашем UI снимает
        // блюдо со стопа везде, включая стопы кассира в основной KDS.
        // Подробности в Инструкция.md → раздел 10 → «Политика mastership».
        //
        // Для каждого блюда в группе порядок шагов важен из-за триггера
        // slicer_archive_rgst3_delete (миграция 021):
        //   1. Если есть в slicer — пишем нашу историю с resumed_by_*.
        //   2. pushDishUnstopAll — DELETE всех rgst3 строк для этого блюда:
        //      - линкованные (наши) — триггер пропускает, история уже есть
        //      - нелинкованные (кассирские) — триггер архивирует с actor_source='kds'
        //   3. DELETE из slicer_dish_stoplist (после rgst3, чтобы линковка жила).
        for (const id of aliasGroup) {
          const idSliceRes = await client.query(
            `SELECT stop_type, reason, stopped_at, rgst3_row_suuid,
                    stopped_by_uuid, stopped_by_name, actor_source
               FROM slicer_dish_stoplist WHERE dish_id = $1`,
            [id]
          );
          const idInSlicer = idSliceRes.rows.length > 0;

          if (idInSlicer) {
            const row = idSliceRes.rows[0];
            const now = new Date();
            const stoppedAt = new Date(row.stopped_at);
            const durationMs = now.getTime() - stoppedAt.getTime();

            await client.query(
              `INSERT INTO slicer_stop_history
                (target_type, target_id, target_name, stopped_at, resumed_at, reason, duration_ms,
                 stopped_by_uuid, stopped_by_name,
                 resumed_by_uuid, resumed_by_name,
                 actor_source)
               VALUES ('dish', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                id, dishName, stoppedAt, now,
                row.reason || 'Manual', durationMs,
                row.stopped_by_uuid, row.stopped_by_name,
                actor.uuid, actor.name,
                row.actor_source || 'slicer',
              ]
            );
          }

          // Удаляем все rgst3 строки для этого блюда (наши + чужие).
          await pushDishUnstopAll(client, id);

          if (idInSlicer) {
            await client.query(
              `DELETE FROM slicer_dish_stoplist WHERE dish_id = $1`,
              [id]
            );
          }
        }

        // После снятия пересчитываем каскады — если ингредиент всё ещё на
        // стопе, recalculateCascadeStops вернёт CASCADE-строки для нужных
        // блюд (включая их алиасы — это уже умеет SQL внутри функции).
        await recalculateCascadeStops(client, actor);

        await client.query('COMMIT');
        res.json({ toggled: true, is_stopped: false, alias_group_size: aliasGroup.length });
        return;
      }

      await client.query('ROLLBACK');
      res.status(400).json({ error: 'targetType должен быть ingredient или dish' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[StopList] Ошибка toggle:', err);
    res.status(500).json({ error: 'Ошибка переключения стоп-листа' });
  }
});

/**
 * GET /api/stoplist/history — Получить историю стопов для Dashboard.
 * Query params: from (ISO date), to (ISO date).
 *
 * Источники (UNION):
 *   1. slicer_stop_history — снятые стопы, включая:
 *      - постановки нарезчиком через наш UI,
 *      - снятия кассиров через основную KDS (ловятся триггером миграции 011).
 *   2. rgst3_dishstoplist архив из ЗАКРЫТЫХ смен — стопы дожившие до
 *      конца смены (триггер не срабатывает, DELETE не было). Их
 *      resumed_at = ctlg14_closetime.
 *
 * Фильтр по **пересечению интервалов** с [from; to]: запись попадает
 * если stopped_at <= to AND resumed_at >= from (стоп, начавшийся вчера и
 * завершённый сегодня, в сегодняшнем отчёте виден).
 *
 * Пересечения между источниками быть не должно:
 *   - slicer_stop_history = уже удалённые из rgst3 строки;
 *   - rgst3 архив = живые строки в закрытых сменах.
 * Дедупликация лишняя, UNION ALL безопасен.
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;

    // Alias-resolve: для слитых через Рецепты → Связать блюд (напр. 184 и Д184)
    // показывать имя PRIMARY блюда. Это позволяет Dashboard склеить записи
    // зала и доставки в одну карточку и union'ом убрать двойной учёт времени.
    // Если алиасов нет — target_name остаётся как записан триггером/модулем.
    const aliasesRes = await pool.query(`
      SELECT a.alias_dish_id,
             COALESCE(pd.code || ' ', '') || COALESCE(pd.name, '') AS primary_display_name
        FROM slicer_dish_aliases a
        LEFT JOIN ctlg15_dishes pd ON pd.suuid::text = a.primary_dish_id
    `);
    const aliasDisplayName = new Map<string, string>();
    for (const r of aliasesRes.rows) {
      if (r.primary_display_name && r.primary_display_name.trim() !== '') {
        aliasDisplayName.set(r.alias_dish_id, r.primary_display_name.trim());
      }
    }

    // === Источник 1: slicer_stop_history (наш модуль + триггер) ===
    let sliceQuery = 'SELECT * FROM slicer_stop_history';
    const sliceParams: any[] = [];
    if (from && to) {
      sliceQuery += ' WHERE (resumed_at IS NULL OR resumed_at >= $1) AND stopped_at <= $2';
      sliceParams.push(from, to);
    } else if (from) {
      sliceQuery += ' WHERE (resumed_at IS NULL OR resumed_at >= $1)';
      sliceParams.push(from);
    } else if (to) {
      sliceQuery += ' WHERE stopped_at <= $1';
      sliceParams.push(to);
    }
    sliceQuery += ' ORDER BY stopped_at DESC';
    const sliceResult = await pool.query(sliceQuery, sliceParams);

    // === Источник 2: rgst3 архив закрытых смен ===
    // insert_date = когда кассир поставил стоп.
    // ctlg14_closetime = когда смена закрылась (условная «граница снятия»).
    // Если смена ещё открыта — не берём: живые стопы уже видны в GET /api/dishes.
    // target_name с префиксом code — так зал (184) и доставка (Д184) видны
    // как разные записи. Alias-resolve применяется в JS-слое ниже через
    // aliasDisplayName.
    // LEFT JOIN users ON u.uuid::text = r.inserter — резолв автора стопа
    // из чужой rgst3.inserter (UUID юзера как text) в ФИО. Если юзер удалён
    // или inserter не совпадает с users — stopped_by_* = NULL.
    let rgstQuery = `
      SELECT
        'rgst3_archive' AS id_prefix,
        r.suuid::text AS raw_id,
        'dish' AS target_type,
        r.rgst3_ctlg15_uuid__dish::text AS target_id,
        CASE
          WHEN d.code IS NOT NULL AND d.code <> ''
            THEN d.code || ' ' || COALESCE(d.name, 'Unknown dish')
          ELSE COALESCE(d.name, 'Unknown dish')
        END AS target_name,
        r.insert_date AS stopped_at,
        s.ctlg14_closetime AS resumed_at,
        NULLIF(r.comment, '') AS reason,
        GREATEST(0, EXTRACT(EPOCH FROM s.ctlg14_closetime - r.insert_date) * 1000)::BIGINT AS duration_ms,
        u.uuid AS stopped_by_uuid,
        TRIM(u.login) AS stopped_by_name
      FROM rgst3_dishstoplist r
      JOIN ctlg14_shifts s ON s.suuid = r.rgst3_ctlg14_uuid__shift
      LEFT JOIN ctlg15_dishes d ON d.suuid = r.rgst3_ctlg15_uuid__dish
      LEFT JOIN users u ON u.uuid::text = r.inserter
      WHERE s.ctlg14_closed = true
        AND s.ctlg14_closetime IS NOT NULL
    `;
    const rgstParams: any[] = [];
    if (from && to) {
      rgstQuery += ' AND s.ctlg14_closetime >= $1 AND r.insert_date <= $2';
      rgstParams.push(from, to);
    } else if (from) {
      rgstQuery += ' AND s.ctlg14_closetime >= $1';
      rgstParams.push(from);
    } else if (to) {
      rgstQuery += ' AND r.insert_date <= $1';
      rgstParams.push(to);
    }
    const rgstResult = await pool.query(rgstQuery, rgstParams);

    // === Маппинг к формату StopHistoryEntry ===
    // resumed_at fallback → stopped_at (durationMs=0), чтобы не врать при
    // NULL. На практике для slicer_stop_history всегда заполняется в INSERT.
    // Helper: для dish-записи применяет alias-resolve (если связано через
    // slicer_dish_aliases) — иначе возвращает имя из БД как есть.
    const resolveDishName = (targetId: string, fallback: string): string => {
      return aliasDisplayName.get(targetId) || fallback;
    };

    const sliceEntries = sliceResult.rows.map((row) => {
      const stoppedAtMs = new Date(row.stopped_at).getTime();
      const displayName = row.target_type === 'dish'
        ? `[DISH] ${resolveDishName(row.target_id, row.target_name)}`
        : row.target_name;
      return {
        id: row.id,
        ingredientName: displayName,
        stoppedAt: stoppedAtMs,
        resumedAt: row.resumed_at ? new Date(row.resumed_at).getTime() : stoppedAtMs,
        reason: row.reason || 'Unknown',
        durationMs: row.duration_ms ? Number(row.duration_ms) : 0,
        stoppedByUuid: row.stopped_by_uuid || null,
        stoppedByName: row.stopped_by_name || null,
        resumedByUuid: row.resumed_by_uuid || null,
        resumedByName: row.resumed_by_name || null,
        actorSource: row.actor_source || null,
      };
    });

    const rgstEntries = rgstResult.rows.map((row) => {
      const stoppedAtMs = new Date(row.stopped_at).getTime();
      // rgst3-архив закрытых смен: актор доступен через OLD.inserter даже если
      // триггер не сработал (DELETE не было). Маппим UUID → ФИО через users.
      // resumed_by_* отсутствует — смена закрылась, ответственного за снятие нет.
      return {
        id: `rgst3_archive_${row.raw_id}`,
        ingredientName: `[DISH] ${resolveDishName(row.target_id, row.target_name)}`,
        stoppedAt: stoppedAtMs,
        resumedAt: row.resumed_at ? new Date(row.resumed_at).getTime() : stoppedAtMs,
        reason: row.reason || 'KDS stop',
        durationMs: row.duration_ms ? Number(row.duration_ms) : 0,
        stoppedByUuid: row.stopped_by_uuid || null,
        stoppedByName: row.stopped_by_name || null,
        resumedByUuid: null,
        resumedByName: null,
        actorSource: 'kds',
      };
    });

    // Объединяем и сортируем по stoppedAt DESC — как и раньше для single source.
    const history = [...sliceEntries, ...rgstEntries].sort(
      (a, b) => b.stoppedAt - a.stoppedAt
    );

    res.json(history);
  } catch (err) {
    console.error('[StopList] Ошибка history:', err);
    res.status(500).json({ error: 'Ошибка получения истории стопов' });
  }
});

export default router;
