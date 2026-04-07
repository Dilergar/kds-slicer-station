/**
 * utils.ts — Вспомогательные утилиты проекта KDS Slicer Station
 *
 * Содержит:
 * - generateId() — генерация уникальных идентификаторов
 * - calculateConsumedIngredients() — расчёт потреблённых ингредиентов при выполнении заказа
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
