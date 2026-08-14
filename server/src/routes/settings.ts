/**
 * Маршруты для настроек модуля нарезчика (slicer_settings).
 * Таблица singleton — всегда одна строка с id=1.
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

/**
 * Валидация числовой настройки в диапазоне [min..max].
 * Возвращает текст ошибки, либо null если значение не прислано (не трогаем
 * поле) или валидно. Единая точка для числовых границ — раньше каждый
 * параметр копировал одинаковый блок проверки, рискуя опечаткой в границах.
 *
 * @param value Присланное значение (undefined/null = поле не меняется)
 * @param name Имя поля для текста ошибки
 * @param min Нижняя граница (включительно)
 * @param max Верхняя граница (включительно)
 */
const validateIntRange = (
  value: unknown,
  name: string,
  min: number,
  max: number
): string | null => {
  if (value == null) return null;
  // Number.isInteger обязателен: без него 10.5 проходил проверку и уезжал
  // в INT-колонку, где Postgres отвечал 500 вместо понятной 400.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return `${name} должен быть целым числом ${min}..${max}`;
  }
  return null;
};

/**
 * Проверяет список номеров столов-домиков (миграция 030).
 * Схема гарантирует только отсутствие NULL и длину массива — «номер стола
 * это целое 1..9999» в CHECK не выразить без подзапроса, поэтому диапазон
 * закрываем здесь: с мусором вроде 0 или -5 метка молча не совпала бы ни
 * с одним столом, и владелец решил бы что фича сломана.
 *
 * @param value Присланное значение (undefined/null = поле не меняется)
 */
const validateHouseTables = (value: unknown): string | null => {
  if (value == null) return null;
  if (!Array.isArray(value)) return 'houseTables должен быть массивом номеров столов';
  if (value.length > 100) return 'houseTables: не более 100 столов';
  const ok = value.every(
    (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9999
  );
  if (!ok) return 'houseTables: номер стола должен быть целым числом 1..9999';
  return null;
};

/**
 * Проверяет строку времени формата HH:MM.
 * @param value Присланное значение (undefined/null = поле не меняется)
 * @param name Имя поля для текста ошибки
 */
const validateTimeString = (value: unknown, name: string): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return `${name} должен быть временем в формате ЧЧ:ММ`;
  }
  return null;
};

/** GET /api/settings — Получить все настройки */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM slicer_settings WHERE id = 1');
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Настройки не найдены' });
      return;
    }
    const row = result.rows[0];
    // Маппинг snake_case → camelCase для совместимости с типом SystemSettings
    res.json({
      aggregationWindowMinutes: row.aggregation_window_minutes,
      historyRetentionMinutes: row.history_retention_minutes,
      activePriorityRules: row.active_priority_rules,
      courseWindowSeconds: row.course_window_seconds,
      // Шаг курса умной очереди v2 (миграция 023)
      coursePaceSeconds: row.course_pace_seconds,
      restaurantOpenTime: row.restaurant_open_time,
      restaurantCloseTime: row.restaurant_close_time,
      excludedDates: row.excluded_dates,
      enableAggregation: row.enable_aggregation,
      enableSmartAggregation: row.enable_smart_aggregation,
      enableKdsStoplistSync: row.enable_kds_stoplist_sync,
      // Разморозка (миграция 016, 020): глобальное время убрано, живёт per-dish
      // в slicer_dish_defrost. Здесь остался только toggle звука.
      enableDefrostSound: row.enable_defrost_sound,
      // Звук поступления нового заказа (миграция 026)
      enableNewOrderSound: row.enable_new_order_sound,
      // Столы-домики: номера, которые на карточке рисуются кирпичной
      // «крышей» вместо обычного жёлтого (миграция 030)
      houseTables: row.house_tables ?? [],
      // Авто-парковка десертов (миграции 017 + 019)
      dessertCategoryId: row.dessert_category_id,
      dessertAutoParkEnabled: row.dessert_auto_park_enabled,
      dessertAutoParkMinutes: row.dessert_auto_park_minutes,
      dessertTriggerModifierPatterns: row.dessert_trigger_modifier_patterns
    });
  } catch (err) {
    console.error('[Settings] Ошибка GET:', err);
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

/** PUT /api/settings — Обновить настройки */
router.put('/', async (req: Request, res: Response) => {
  try {
    const {
      aggregationWindowMinutes,
      historyRetentionMinutes,
      activePriorityRules,
      courseWindowSeconds,
      coursePaceSeconds,
      restaurantOpenTime,
      restaurantCloseTime,
      excludedDates,
      enableAggregation,
      enableSmartAggregation,
      enableKdsStoplistSync,
      enableDefrostSound,
      enableNewOrderSound,
      houseTables,
      dessertCategoryId,
      dessertAutoParkEnabled,
      dessertAutoParkMinutes,
      dessertTriggerModifierPatterns
    } = req.body;

    // Валидация числовых диапазонов. Границы дублируют CHECK'и БД:
    // course_pace_seconds 10..3600 (миграция 025), dessert_auto_park_minutes
    // 1..240 (миграция 017) — API отвечает понятной 400-кой вместо 500-ки
    // от нарушенного constraint'а.
    const rangeError =
      validateIntRange(coursePaceSeconds, 'coursePaceSeconds', 10, 3600) ??
      validateIntRange(dessertAutoParkMinutes, 'dessertAutoParkMinutes', 1, 240) ??
      // Раньше эти три не проверялись НИГДЕ — ни здесь, ни CHECK'ом в БД:
      // единственной защитой был кламп в админке. Прямой запрос записывал что
      // угодно, включая 0 для courseWindowSeconds — а на нём в стандартном
      // режиме строится bucket сортировки (деление на ноль → Infinity в ключе).
      validateIntRange(courseWindowSeconds, 'courseWindowSeconds', 10, 3600) ??
      validateIntRange(historyRetentionMinutes, 'historyRetentionMinutes', 1, 120) ??
      validateIntRange(aggregationWindowMinutes, 'aggregationWindowMinutes', 1, 240);
    if (rangeError) {
      res.status(400).json({ error: rangeError });
      return;
    }

    // Часы работы ресторана — строго HH:MM, иначе расчёт рабочего времени
    // в отчётах молча получит NaN и проценты простоя станут бессмысленными.
    const timeError =
      validateTimeString(restaurantOpenTime, 'restaurantOpenTime') ??
      validateTimeString(restaurantCloseTime, 'restaurantCloseTime');
    if (timeError) {
      res.status(400).json({ error: timeError });
      return;
    }

    // Столы-домики (миграция 030)
    const houseTablesError = validateHouseTables(houseTables);
    if (houseTablesError) {
      res.status(400).json({ error: houseTablesError });
      return;
    }
    // Нормализуем на входе: дубли и произвольный порядок ничего не ломают,
    // но список возвращается в UI как есть — «30, 7, 30» выглядел бы сбоем.
    const normalizedHouseTables: number[] | null =
      houseTables == null
        ? null
        : Array.from(new Set(houseTables as number[])).sort((a, b) => a - b);

    // ─────────────────────────────────────────────────────────────────────────
    // Килсвитч записи в чужую таблицу через этот эндпоинт НЕ переключается.
    //
    // enable_kds_stoplist_sync — единственное, что отделяет модуль от записи
    // в боевую rgst3_dishstoplist заказчика (правило 3 в CLAUDE.md). Раньше он
    // лежал в общем словаре настроек и менялся тем же запросом, что и громкость
    // звука: любой, кто дотянулся до порта 3001, мог включить его одним PUT,
    // а следующим запросом снять со стопа блюдо — pushDishUnstopAll удаляет ВСЕ
    // строки блюда в текущей смене, включая поставленные кассиром.
    //
    // Теперь флаг меняется только при развёртывании — SQL-ом по инструкции
    // (Инструкция.md → «Двусторонняя синхронизация стоп-листа»):
    //   UPDATE slicer_settings SET enable_kds_stoplist_sync = true WHERE id = 1;
    // Присланное в теле значение молча игнорируем, но пишем предупреждение
    // в лог — чтобы попытка была видна при разборе.
    if (enableKdsStoplistSync !== undefined) {
      console.warn(
        '[Settings] Попытка изменить enable_kds_stoplist_sync через API отклонена. ' +
        'Флаг записи в чужую таблицу меняется только SQL-ом при развёртывании.'
      );
    }

    // Валидация dessertTriggerModifierPatterns: массив непустых строк.
    if (
      dessertTriggerModifierPatterns != null &&
      (!Array.isArray(dessertTriggerModifierPatterns) ||
        !dessertTriggerModifierPatterns.every((p: unknown) => typeof p === 'string' && p.length > 0))
    ) {
      res.status(400).json({ error: 'dessertTriggerModifierPatterns должен быть массивом непустых строк' });
      return;
    }

    const result = await pool.query(
      `UPDATE slicer_settings SET
        aggregation_window_minutes = COALESCE($1, aggregation_window_minutes),
        history_retention_minutes = COALESCE($2, history_retention_minutes),
        active_priority_rules = COALESCE($3, active_priority_rules),
        course_window_seconds = COALESCE($4, course_window_seconds),
        restaurant_open_time = COALESCE($5, restaurant_open_time),
        restaurant_close_time = COALESCE($6, restaurant_close_time),
        excluded_dates = COALESCE($7, excluded_dates),
        enable_aggregation = COALESCE($8, enable_aggregation),
        enable_smart_aggregation = COALESCE($9, enable_smart_aggregation),
        -- enable_kds_stoplist_sync НАМЕРЕННО не меняется через этот эндпоинт
        -- (см. блок про килсвитч выше) — поэтому присваиваем колонку самой себе.
        --
        -- ⚠️ Нумерация параметров ДОЛЖНА быть сплошной. Когда килсвитч убрали
        -- из запроса (ревью 2026-08-14), его $10 остался в массиве значений
        -- «чтобы не перенумеровывать остальные», но в тексте запроса исчез.
        -- Postgres выводит типы параметров ИЗ ТЕКСТА запроса: на неупомянутый
        -- $10 он отвечал «не удалось определить тип данных параметра $10», и
        -- PUT падал 500-кой на ЛЮБОЙ настройке — админка молча откатывала
        -- изменение и перечитывала старые значения из БД. Дыру в нумерации
        -- здесь не оставлять.
        enable_kds_stoplist_sync = enable_kds_stoplist_sync,
        enable_defrost_sound = COALESCE($10, enable_defrost_sound),
        enable_new_order_sound = COALESCE($17, enable_new_order_sound),
        -- Десерты: dessert_category_id может прийти явным null (отвязать),
        -- поэтому НЕ через COALESCE — используем флаг $14 "трогаем ли это поле".
        dessert_category_id = CASE WHEN $14::bool THEN $11::uuid ELSE dessert_category_id END,
        dessert_auto_park_enabled = COALESCE($12, dessert_auto_park_enabled),
        dessert_auto_park_minutes = COALESCE($13, dessert_auto_park_minutes),
        dessert_trigger_modifier_patterns = COALESCE($15::text[], dessert_trigger_modifier_patterns),
        course_pace_seconds = COALESCE($16, course_pace_seconds),
        -- Столы-домики (миграция 030). Пустой массив — валидное значение
        -- «меток нет», поэтому COALESCE отличает его от «поле не прислали»
        -- только потому, что не присланное поле уходит сюда как NULL.
        house_tables = COALESCE($18::integer[], house_tables),
        updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        aggregationWindowMinutes,
        historyRetentionMinutes,
        activePriorityRules ? JSON.stringify(activePriorityRules) : null,
        courseWindowSeconds,
        restaurantOpenTime,
        restaurantCloseTime,
        excludedDates ? JSON.stringify(excludedDates) : null,
        enableAggregation,
        enableSmartAggregation,
        // Плейсхолдера под килсвитч синхронизации здесь БОЛЬШЕ НЕТ: значение,
        // которому не соответствует параметр в тексте запроса, ломает весь
        // PUT (см. комментарий про нумерацию выше). Флаг меняется только SQL-ом.
        enableDefrostSound,
        dessertCategoryId ?? null,
        dessertAutoParkEnabled,
        dessertAutoParkMinutes,
        // Флаг: клиент явно прислал поле dessertCategoryId (в т.ч. null) —
        // значит хочет его изменить. Отсутствие ключа в body → не трогаем.
        Object.prototype.hasOwnProperty.call(req.body, 'dessertCategoryId'),
        dessertTriggerModifierPatterns ?? null,
        coursePaceSeconds ?? null,
        // $17: звук нового заказа (миграция 026)
        enableNewOrderSound,
        // $18: столы-домики (миграция 030) — отсортированы и без дублей
        normalizedHouseTables
      ]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Настройки не найдены' });
      return;
    }
    const row = result.rows[0];
    res.json({
      aggregationWindowMinutes: row.aggregation_window_minutes,
      historyRetentionMinutes: row.history_retention_minutes,
      activePriorityRules: row.active_priority_rules,
      courseWindowSeconds: row.course_window_seconds,
      coursePaceSeconds: row.course_pace_seconds,
      restaurantOpenTime: row.restaurant_open_time,
      restaurantCloseTime: row.restaurant_close_time,
      excludedDates: row.excluded_dates,
      enableAggregation: row.enable_aggregation,
      enableSmartAggregation: row.enable_smart_aggregation,
      enableKdsStoplistSync: row.enable_kds_stoplist_sync,
      enableDefrostSound: row.enable_defrost_sound,
      enableNewOrderSound: row.enable_new_order_sound,
      houseTables: row.house_tables ?? [],
      dessertCategoryId: row.dessert_category_id,
      dessertAutoParkEnabled: row.dessert_auto_park_enabled,
      dessertAutoParkMinutes: row.dessert_auto_park_minutes,
      dessertTriggerModifierPatterns: row.dessert_trigger_modifier_patterns
    });
  } catch (err) {
    console.error('[Settings] Ошибка PUT:', err);
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

export default router;
