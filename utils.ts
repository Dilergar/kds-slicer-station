/**
 * utils.ts — Вспомогательные утилиты проекта KDS Slicer Station
 *
 * Содержит:
 * - generateId() — генерация уникальных идентификаторов
 * - calculateConsumedIngredients() — расчёт потреблённых ингредиентов при выполнении заказа
 * - playDefrostBeep() — звуковой сигнал готовности разморозки (Web Audio)
 * - playNewOrderBeep() — звуковой сигнал поступления нового заказа (Web Audio)
 */

import { Dish, OrderHistoryEntry, IngredientBase } from './types';

/**
 * Генерация уникального идентификатора с произвольным префиксом
 * Использует crypto.randomUUID() если доступен, иначе — fallback на Date.now() + random
 *
 * @param prefix — Префикс для ID (например, 'o' для заказов, 'oh' для истории)
 * @returns Строка вида "o_550e8400-e29b-41d4-a716-446655440000"
 */
export const generateId = (prefix: string = 'id'): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    // Fallback для старых окружений (хотя современные браузеры поддерживают randomUUID)
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Расчёт потреблённых ингредиентов при выполнении заказа
 *
 * Используется при:
 * - Полном выполнении заказа (handleCompleteOrder)
 * - Частичном выполнении (handlePartialComplete)
 *
 * Логика расчёта:
 * - Для ингредиентов в штуках (piece): количество_на_порцию × кол-во_порций
 *   Вес = количество_штук × вес_одной_штуки
 * - Для ингредиентов в граммах (kg): граммы_на_порцию × кол-во_порций
 *   Вес = итоговые_граммы
 *
 * @param dish — Объект блюда с привязанными ингредиентами
 * @param ingredients — Полный справочник ингредиентов (для получения unitType и веса)
 * @param quantity — Количество порций
 * @returns Массив потреблённых ингредиентов для записи в историю
 */
export const calculateConsumedIngredients = (
    dish: Dish,
    ingredients: IngredientBase[],
    quantity: number
): OrderHistoryEntry['consumedIngredients'] => {
    // Защита от передачи блюда без ингредиентов
    if (!dish || !dish.ingredients) return [];

    return dish.ingredients.map(dishIng => {
        // Находим определение ингредиента в общем справочнике
        const ingDef = ingredients.find(i => i.id === dishIng.id);
        if (!ingDef) return null;

        const unitType = ingDef.unitType || 'kg';
        let qty = 0;            // Количество (штуки или граммы)
        let weightGrams = 0;    // Всегда в граммах (для агрегации)

        if (unitType === 'piece') {
            // Ингредиент в штуках: умножаем количество штук на порцию × кол-во порций
            qty = (dishIng.quantity || 0) * quantity;
            // Переводим в граммы для отчётности
            weightGrams = qty * (ingDef.pieceWeightGrams || 0);
        } else {
            // Ингредиент в граммах: умножаем граммы на порцию × кол-во порций
            qty = (dishIng.quantity || 0) * quantity;
            weightGrams = qty; // Уже в граммах
        }

        return {
            id: ingDef.id,
            name: ingDef.name,
            imageUrl: ingDef.imageUrl,
            unitType,
            quantity: qty,
            weightGrams
        };
    }).filter(Boolean) as OrderHistoryEntry['consumedIngredients'];
};

/**
 * Проигрывает короткий 3-тональный beep через Web Audio API — сигнал
 * «разморозка готова». Отдельной зависимости не добавляем — API нативный.
 *
 * Вызывается из SlicerStation при живом переходе таймера разморозки из
 * состояния «идёт» в «истёк» (см. эффект defrostSoundStateRef). Раньше жил
 * в DefrostRow, но туда попадали только АКТИВНЫЕ разморозки — истёкшие
 * исчезали из списка тем же тиком, и сигнал не срабатывал никогда.
 */
export const playDefrostBeep = (): void => {
    try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const t0 = ctx.currentTime;
        // Три коротких тона нарастающей частоты — характерный «готовность» паттерн.
        const tones = [660, 880, 1100];
        tones.forEach((freq: number, i: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.15);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0 + i * 0.18);
            osc.stop(t0 + i * 0.18 + 0.18);
        });
        // Закрываем контекст через секунду, чтобы не копить ресурсы.
        setTimeout(() => { try { ctx.close(); } catch { /* контекст уже закрыт */ } }, 1000);
    } catch (err) {
        console.warn('[utils] Ошибка воспроизведения звука разморозки:', err);
    }
};

/**
 * Проигрывает двойной короткий beep («динь-динь») через Web Audio API —
 * сигнал «поступил новый заказ». Паттерн намеренно отличается от
 * 3-тонального нарастающего сигнала разморозки (playDefrostBeep), чтобы
 * нарезчик различал события на слух, не глядя в планшет.
 *
 * Вызывается из SlicerStation при появлении в поллинге заказа с ранее не
 * виденным id (см. эффект knownOrderIdsRef). Глобальный тумблер —
 * slicer_settings.enable_new_order_sound (миграция 026, по умолчанию ВКЛ).
 */
export const playNewOrderBeep = (): void => {
    try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const t0 = ctx.currentTime;
        // Два одинаковых высоких тона — короче и «легче» сигнала разморозки.
        const tones = [1040, 1040];
        tones.forEach((freq: number, i: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0 + i * 0.16);
            gain.gain.exponentialRampToValueAtTime(0.22, t0 + i * 0.16 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0 + i * 0.16);
            osc.stop(t0 + i * 0.16 + 0.14);
        });
        // Закрываем контекст, чтобы не копить ресурсы (как в playDefrostBeep).
        setTimeout(() => { try { ctx.close(); } catch { /* контекст уже закрыт */ } }, 800);
    } catch (err) {
        console.warn('[utils] Ошибка воспроизведения звука нового заказа:', err);
    }
};
