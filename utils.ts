/**
 * utils.ts — Вспомогательные утилиты проекта KDS Slicer Station
 *
 * Содержит:
 * - generateId() — генерация уникальных идентификаторов
 * - calculateConsumedIngredients() — расчёт потреблённых ингредиентов при выполнении заказа
 * - withParentPrefix() / withoutParentPrefix() — приставка сырья в названии разновидности
 * - blurOnWheel() — защита числовых полей от прокрутки колесом мыши
 * - playDefrostBeep() — звуковой сигнал готовности разморозки (Web Audio)
 * - playNewOrderBeep() — звуковой сигнал поступления нового заказа (Web Audio)
 */

import type { WheelEvent as ReactWheelEvent } from 'react';
import { Dish, OrderHistoryEntry, IngredientBase } from './types';

/**
 * Защита <input type="number"> от случайного изменения значения колесом мыши.
 *
 * Проблема: браузер крутит значение сфокусированного числового поля колесом.
 * Нарезчик вбивает граммовку, ведёт колесом вниз чтобы прокрутить список
 * ингредиентов — и вместо прокрутки молча получает 45 г вместо 35 г. Ошибка
 * незаметная: поле выглядит нормально, а рецепт уже испорчен.
 *
 * Решение: на колесо снимаем фокус — браузер применяет прокрутку только к
 * СФОКУСИРОВАННОМУ полю, поэтому значение остаётся прежним, а страница/список
 * прокручиваются как обычно. Значение меняется только клавишами и стрелками
 * спиннера.
 *
 * Почему не preventDefault(): React вешает wheel на корень как passive-слушатель,
 * preventDefault() внутри onWheel игнорируется (и заодно заблокировал бы саму
 * прокрутку, которая нарезчику как раз и нужна).
 *
 * @param e — событие колеса на числовом поле
 */
export const blurOnWheel = (e: ReactWheelEvent<HTMLInputElement>) => {
  e.currentTarget.blur();
};

/** Разделитель между сырьём и его нарезкой: «Вешенки · Крупная соломка». */
export const VARIETY_SEPARATOR = ' · ';

/**
 * Добавляет приставку сырья к названию разновидности.
 *
 * Зачем приставка вообще: на карточке заказа и в рецептах видно только имя
 * разновидности, а «Кубик» сам по себе бесполезен — кубиком режут морковь,
 * огурцы, репчатый лук, перец, говядину и судака. Без приставки нарезчику
 * пришлось бы открывать фото, чтобы понять, что резать.
 *
 * Почему приставка лежит в САМОМ названии, а не собирается при отрисовке:
 * имя ингредиента выводится в семи местах, включая SQL на бэкенде (причина
 * стопа «Missing: X» в stoplist.ts, выдача рецептов в recipes.ts) и снимок
 * расхода в slicer_ingredient_consumption. Денормализация закрывает все
 * сразу и не даёт пропустить точку вывода.
 *
 * Идемпотентна: если приставка уже стоит, второй раз не добавится.
 *
 * @param childName — название разновидности («Крупная соломка»)
 * @param parentName — название сырья («Вешенки»); пустое — вернёт имя как есть
 * @returns «Вешенки · Крупная соломка»
 */
export const withParentPrefix = (childName: string, parentName?: string): string => {
    const clean = childName.trim();
    const parent = (parentName || '').trim();
    if (!parent) return clean;
    const prefix = parent + VARIETY_SEPARATOR;
    return clean.startsWith(prefix) ? clean : prefix + clean;
};

/**
 * Убирает приставку сырья из названия разновидности.
 *
 * Нужна там, где название сырья и так перед глазами: внутри модалки этого же
 * сырья (оно в заголовке) и в поле редактирования — иначе нарезчик правит
 * строку «Вешенки · Крупная соломка» и рискует затереть приставку руками.
 * За пределами модалки имя всегда показывается целиком.
 *
 * @param childName — полное название («Вешенки · Крупная соломка»)
 * @param parentName — название сырья; пустое или не совпало — вернёт как есть
 * @returns «Крупная соломка»
 */
export const withoutParentPrefix = (childName: string, parentName?: string): string => {
    const parent = (parentName || '').trim();
    if (!parent) return childName;
    const prefix = parent + VARIETY_SEPARATOR;
    return childName.startsWith(prefix) ? childName.slice(prefix.length) : childName;
};

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
 * Единый AudioContext приложения.
 *
 * Зачем один на всех, а не по контексту на сигнал (как было раньше): браузер
 * создаёт AudioContext в состоянии suspended, пока по странице не было ни одного
 * жеста пользователя. Сигналы же инициируются таймером и поллингом, а не кликом.
 * Поэтому утром, когда планшет обновили и оставили, первый заказ приходил молча —
 * и так до тех пор, пока кто-нибудь не тапнет по экрану. Общий контекст можно
 * один раз «разбудить» на первом же касании (см. installAudioUnlock).
 */
let sharedAudioCtx: AudioContext | null = null;

/**
 * Возвращает общий AudioContext, создавая его при первом обращении
 * и пытаясь вывести из состояния suspended.
 * @returns контекст либо null, если Web Audio недоступен
 */
function getAudioContext(): AudioContext | null {
    try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
        if (sharedAudioCtx!.state === 'suspended') {
            // resume() до жеста отклонится — это нормально, ловим и идём дальше
            void sharedAudioCtx!.resume().catch(() => { /* ждём жеста */ });
        }
        return sharedAudioCtx;
    } catch {
        return null;
    }
}

/**
 * Вешает одноразовые слушатели на первое касание/нажатие клавиши, чтобы
 * разбудить звук. Вызывается один раз при старте приложения; гарантированный
 * жест на кухне — ввод PIN в начале смены.
 * @returns функция снятия слушателей (для cleanup в useEffect)
 */
export const installAudioUnlock = (): (() => void) => {
    const unlock = () => {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => { /* не вышло — попробуем на следующем жесте */ });
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
    };
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
        const ctx = getAudioContext();
        if (!ctx) return;
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
        // Контекст НЕ закрываем — он общий и переиспользуется следующими сигналами.
        // Осцилляторы освобождаются сами после stop().
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
        const ctx = getAudioContext();
        if (!ctx) return;
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
        // Контекст общий и не закрывается (как в playDefrostBeep).
    } catch (err) {
        console.warn('[utils] Ошибка воспроизведения звука нового заказа:', err);
    }
};
