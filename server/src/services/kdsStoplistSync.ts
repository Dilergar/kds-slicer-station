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
 * Включение: см. раздел «Двусторонняя синхронизация стоп-листа» в
 * корневом файле Инструкция.md.
 */
import type { PoolClient } from 'pg';

interface SyncConfig {
  restaurantId: string;
  menuId: string;
  responsibleUserId: string;
  inserterText: string;
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
 * Записать стоп блюда в rgst3_dishstoplist. Возвращает suuid созданной строки
 * (для последующего DELETE) или null если синхронизация выключена.
 *
 * Должна вызываться внутри транзакции вместе с записью в slicer_dish_stoplist —
 * если этот INSERT упадёт, нужно откатить и нашу строку чтобы не было рассинхрона.
 */
export async function pushDishStop(
  client: PoolClient,
  dishId: string,
  reason: string | null
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
      config.inserterText,
      reason || 'Stopped by slicer module',
      dishId,
      config.restaurantId,
      shiftId,
      config.menuId,
      config.responsibleUserId,
    ]
  );

  return insertRes.rows[0].suuid;
}

/**
 * Удалить нашу строку из rgst3_dishstoplist по сохранённому suuid.
 * No-op если синхронизация выключена или suuid пустой.
 */
export async function pushDishUnstop(
  client: PoolClient,
  rgst3RowSuuid: string | null
): Promise<void> {
  if (!rgst3RowSuuid) return;

  const config = await loadSyncConfig(client);
  if (!config) return;

  // Удаляем РОВНО ту строку которую сами создали — по suuid. Это критично:
  // другие записи в rgst3_dishstoplist могут принадлежать кассе или менеджерам,
  // их трогать нельзя.
  await client.query(
    `DELETE FROM rgst3_dishstoplist WHERE suuid = $1`,
    [rgst3RowSuuid]
  );
}
