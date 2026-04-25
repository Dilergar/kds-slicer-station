/**
 * Адаптер двусторонней синхронизации стоп-листа блюд с основной KDS.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННОЕ МЕСТО, где модуль нарезчика пишет в чужую таблицу
 *    rgst3_dishstoplist. Все остальные части backend взаимодействуют со
 *    стоп-листом через slicer_dish_stoplist и не знают про rgst3.
 *
 * Поведение:
 *  - Если slicer_settings.enable_kds_stoplist_sync = FALSE → все функции
 *    возвращают null/no-op. Модуль работает изолированно как раньше.
 *  - Если TRUE → читается slicer_kds_sync_config и при каждом стопе блюда
 *    делается INSERT в rgst3_dishstoplist; при снятии — DELETE по сохранённому
 *    suuid. Всё в той же транзакции что и slicer_dish_stoplist.
 *
 * Per-user атрибуция (актор стопа):
 *  - actor.uuid (users.uuid из PIN-сессии) резолвится в ctlg5_employees.suuid
 *    через ctlg10_useremployees → пишется в rgst3_ctlg5_uuid__responsible.
 *  - actor.uuid (как text) пишется в inserter/updater — позволяет видеть в
 *    основной KDS «кто конкретно поставил стоп», а в Dashboard JOIN по
 *    users.uuid::text = r.inserter резолвит ФИО автора.
 *  - Если actor не передан или не имеет связи с employee → fallback на
 *    config.responsibleUserId / config.inserterText (заполнено программистами
 *    заказчика при включении синхронизации).
 *
 * Включение/выключение: см. раздел «Двусторонняя синхронизация стоп-листа»
 * в корневом файле Инструкция.md.
 */
import type { PoolClient } from 'pg';

interface SyncConfig {
  restaurantId: string;
  menuId: string;
  responsibleUserId: string;
  inserterText: string;
}

/**
 * Актор toggle-операции — залогиненный по PIN юзер. Используется для
 * атрибуции стопа в чужой rgst3_dishstoplist (responsible + inserter).
 * Опционален — при отсутствии используется fallback из slicer_kds_sync_config.
 */
export interface SyncActor {
  uuid?: string | null;
  name?: string | null;
}

/**
 * Прочитать конфиг синхронизации. Возвращает null если синхронизация выключена
 * (флаг false) или конфиг не заполнен.
 */
async function loadSyncConfig(client: PoolClient): Promise<SyncConfig | null> {
  const settings = await client.query(
    'SELECT enable_kds_stoplist_sync FROM slicer_settings WHERE id = 1'
  );
  if (settings.rows.length === 0 || settings.rows[0].enable_kds_stoplist_sync !== true) {
    return null;
  }

  const config = await client.query(
    `SELECT restaurant_id, menu_id, responsible_user_id, inserter_text
     FROM slicer_kds_sync_config WHERE id = 1`
  );
  if (config.rows.length === 0) {
    // Флаг включён, но конфиг пустой — это ошибка установки. Бросаем явно
    // чтобы транзакция откатилась и пользователь увидел проблему.
    throw new Error(
      '[kdsStoplistSync] enable_kds_stoplist_sync = TRUE, но slicer_kds_sync_config пуст. ' +
      'Заполните таблицу через SQL (см. Инструкция.md → «Двусторонняя синхронизация»).'
    );
  }

  const row = config.rows[0];
  return {
    restaurantId: row.restaurant_id,
    menuId: row.menu_id,
    responsibleUserId: row.responsible_user_id,
    inserterText: row.inserter_text,
  };
}

/**
 * Резолвит users.uuid → ctlg5_employees.suuid через ctlg10_useremployees.
 * Возвращает null если связи нет (либо актор не передан, либо у юзера
 * не настроен ctlg10-маппинг). Caller должен использовать fallback.
 */
async function resolveEmployeeId(
  client: PoolClient,
  actorUuid: string | null | undefined
): Promise<string | null> {
  if (!actorUuid) return null;
  const res = await client.query(
    `SELECT ctlg10_ctlg5_uuid__employee
       FROM ctlg10_useremployees
      WHERE ctlg10_user = $1::uuid
      LIMIT 1`,
    [actorUuid]
  );
  return res.rows.length > 0 ? res.rows[0].ctlg10_ctlg5_uuid__employee : null;
}

/**
 * Записать стоп блюда в rgst3_dishstoplist. Возвращает suuid созданной строки
 * (для последующего DELETE) или null если синхронизация выключена.
 *
 * Должна вызываться внутри транзакции вместе с записью в slicer_dish_stoplist —
 * если этот INSERT упадёт, нужно откатить и нашу строку чтобы не было рассинхрона.
 */
export async function pushDishStop(
  client: PoolClient,
  dishId: string,
  reason: string | null,
  actor: SyncActor = {}
): Promise<string | null> {
  const config = await loadSyncConfig(client);
  if (!config) return null;

  // Текущая открытая смена — обязательное поле rgst3_ctlg14_uuid__shift.
  // Берём первую открытую (обычно она одна). Если открытых смен нет, синхронизация
  // не имеет смысла — стоп-лист в их системе привязан к смене.
  const shiftRes = await client.query(
    `SELECT suuid FROM ctlg14_shifts WHERE ctlg14_closed = false ORDER BY ctlg14_opentime DESC LIMIT 1`
  );
  if (shiftRes.rows.length === 0) {
    throw new Error(
      '[kdsStoplistSync] Нет открытой смены в ctlg14_shifts — синхронизация невозможна. ' +
      'Откройте смену в основной KDS перед использованием стоп-листа модуля.'
    );
  }
  const shiftId = shiftRes.rows[0].suuid;

  // Per-user атрибуция: резолвим ctlg5_employees.suuid из users.uuid через
  // ctlg10_useremployees. Если актор не передан / не привязан к employee —
  // fallback на config.responsibleUserId (системный employee из конфига).
  const resolvedEmployeeId = await resolveEmployeeId(client, actor.uuid);
  const responsibleId = resolvedEmployeeId ?? config.responsibleUserId;

  // inserter — текстовое поле, в которое кладём users.uuid (как text).
  // Это позволит JOIN-у `users.uuid::text = r.inserter` в /api/stoplist/history
  // резолвить ФИО актора нашего стопа. Fallback — статичный config.inserterText
  // ('slicer-module' по умолчанию).
  const inserterText = actor.uuid && actor.uuid.length > 0 ? actor.uuid : config.inserterText;

  // INSERT в rgst3_dishstoplist. Используем DEFAULT для id/uuid/suuid/insert_date/
  // update_date/version (эти поля имеют sane defaults в их схеме). Заполняем все
  // NOT NULL поля без дефолта явно. comment получает наш reason для трассируемости.
  const insertRes = await client.query(
    `INSERT INTO rgst3_dishstoplist (
      inserter, updater, comment,
      rgst3_ctlg15_uuid__dish,
      rgst3_ctlg11_uuid__restaurant,
      rgst3_ctlg14_uuid__shift,
      rgst3_ctlg16_uuid__restaurantmenu,
      rgst3_ctlg5_uuid__responsible
    ) VALUES (
      $1, $1, $2,
      $3::uuid,
      $4, $5, $6, $7
    )
    RETURNING suuid`,
    [
      inserterText,
      reason || 'Stopped by slicer module',
      dishId,
      config.restaurantId,
      shiftId,
      config.menuId,
      responsibleId,
    ]
  );

  return insertRes.rows[0].suuid;
}

/**
 * Удалить нашу строку из rgst3_dishstoplist по сохранённому suuid.
 * No-op если синхронизация выключена или suuid пустой.
 *
 * Используется в **каскадной** ветке (recalculateCascadeStops): когда
 * ингредиент возвращается, мы убираем только нашу зеркальную строку и
 * НЕ трогаем чужие стопы кассира на этом же блюде (у кассира могла быть
 * отдельная причина стопа, не связанная с ингредиентом).
 */
export async function pushDishUnstop(
  client: PoolClient,
  rgst3RowSuuid: string | null
): Promise<void> {
  if (!rgst3RowSuuid) return;

  const config = await loadSyncConfig(client);
  if (!config) return;

  // Удаляем РОВНО ту строку которую сами создали — по suuid. Это критично
  // для каскадного flow: чужие стопы кассира на этом блюде должны остаться.
  await client.query(
    `DELETE FROM rgst3_dishstoplist WHERE suuid = $1`,
    [rgst3RowSuuid]
  );
}

/**
 * Удалить ВСЕ строки rgst3_dishstoplist для блюда в текущей открытой смене
 * (и наши зеркальные, и чужие — кассирские, менеджерские).
 *
 * Политика «модуль — мастер стоп-листа»: когда нарезчик через UI снимает
 * блюдо со стопа в нашем модуле, оно должно быть снято со стопа везде.
 * Используется в **ручной** ветке UNSTOP — `routes/stoplist.ts`.
 *
 * Срабатывание триггера `slicer_archive_rgst3_delete_trg` (миграция 021):
 *   - Для линкованных строк (наши через rgst3_row_suuid) → триггер пропускает,
 *     история уже записана в коде с resumed_by_*.
 *   - Для НЕлинкованных (чужие кассирские) → триггер архивирует с actor_source='kds'.
 *
 * No-op если синхронизация выключена.
 */
export async function pushDishUnstopAll(
  client: PoolClient,
  dishId: string
): Promise<void> {
  const config = await loadSyncConfig(client);
  if (!config) return;

  // Открытая смена — стоп-лист в их системе scoped по смене.
  const shiftRes = await client.query(
    `SELECT suuid FROM ctlg14_shifts WHERE ctlg14_closed = false ORDER BY ctlg14_opentime DESC LIMIT 1`
  );
  if (shiftRes.rows.length === 0) {
    // Нет открытой смены → стопов в rgst3 для текущей смены тоже нет → no-op.
    return;
  }
  const shiftId = shiftRes.rows[0].suuid;

  await client.query(
    `DELETE FROM rgst3_dishstoplist
       WHERE rgst3_ctlg15_uuid__dish::text = $1
         AND rgst3_ctlg14_uuid__shift = $2`,
    [dishId, shiftId]
  );
}
