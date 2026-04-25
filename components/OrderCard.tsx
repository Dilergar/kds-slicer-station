/**
 * OrderCard.tsx — Карточка заказа на KDS-доске
 *
 * Отображает блюдо, столы, таймер, стек количеств, список ингредиентов.
 *
 * Ключевые визуальные индикаторы стека:
 * - quantity_stack.length > 1 → "1 + 1", красная стрелка, "ЕЩЁ ЗАКАЗ (ОБЪЕДЕНИТЕ ИХ)", Done заблокирован
 * - quantity_stack.length === 1 → число, кнопка Done доступна
 * - Ингредиенты: "50g + 50g" (при стеке) или "100g" (после merge)
 *
 * Механизм "Scroll-to-Accept": если >5 ингредиентов, кнопка Done блокирована
 * до прокрутки списка до конца. Поддерживает Done, Part Done, Merge.
 *
 * Работает как с реальными Order, так и с виртуальными (Smart Wave Aggregation).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dish, Order, Category, IngredientBase, PriorityLevel } from '../types';
import { Clock, Check, PauseCircle, Car, MoveLeft, ChevronDown, PieChart, AlertTriangle, X, Snowflake } from 'lucide-react';
import { hasDefrostBeenStarted } from '../smartQueue';

interface OrderCardProps {
    order: Order;
    dish: Dish;
    categories: Category[];
    ingredients: IngredientBase[];
    now: number;
    onCompleteOrder: (orderId: string) => void;
    onPartialComplete?: (orderId: string, quantity: number) => void;
    onStackMerge: (orderId: string) => void;
    onCancelOrder?: (orderId: string) => void;
    onPreviewImage: (url: string) => void;
    /**
     * Чисто визуальный флаг «эту карточку уже кто-то начал делать».
     * Тап по незанятой области карточки → toggle. Живёт только в локальном
     * стейте SlicerStation, не пишется в БД, не переживает reload.
     */
    isInWork?: boolean;
    onToggleInWork?: (orderId: string) => void;
    /**
     * Кнопка запуска разморозки (синяя ❄️) — показывается только если
     * dish.requires_defrost=true и разморозка ещё не запускалась. После
     * разморозки (hasDefrostBeenStarted=true) вместо кнопки показывается
     * статичная серая ❄️ — просто индикатор «это блюдо размораживалось».
     */
    onStartDefrost?: (orderId: string) => void;
    /**
     * Подпись большой зелёной кнопки (по умолчанию — «ГОТОВО»).
     * В модалке разморозки (DefrostModal) переопределяется на «РАЗМОРОЗИЛАСЬ»,
     * чтобы переиспользовать весь компонент целиком — пользователь видит ту
     * же карточку что и на доске, но подтверждает другое действие.
     */
    completeButtonLabel?: string;
}

const OrderCardBase: React.FC<OrderCardProps> = ({
    order,
    dish,
    categories,
    ingredients,
    now,
    onCompleteOrder,
    onPartialComplete,
    onStackMerge,
    onCancelOrder,
    onPreviewImage,
    isInWork,
    onToggleInWork,
    onStartDefrost,
    completeButtonLabel,
}) => {
    /**
     * Тап по карточке → toggle «В работе». Игнорируем если тап попал в button
     * (Готово / Частично / Отмена / Merge-бейдж / action-кнопки в футере) —
     * тогда работают их собственные обработчики. Если картинку ингредиента
     * тапнут — тоже toggle'нём, это приемлемо: двойной клик для превью
     * всё равно был ненадёжен на планшете.
     */
    const handleCardTap = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onToggleInWork) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        onToggleInWork(order.id);
    };
    // --- Derived State ---
    // Check stop status (propagate from dish or order logic if needed, but mostly dish)
    // In SlicerStation we used checkStopped helper, let's replicate or assume dish.is_stopped 
    // but SlicerStation had: const stoppedIngredientName = checkStopped(dish);
    // We can just check dish.is_stopped directly as that is the source of truth for the Board
    const isStopped = !!dish.is_stopped;
    const stopReason = dish.stop_reason || 'Unavailable';

    // Каскадный стоп от ингредиента vs ручной стоп блюда:
    // если в рецепте есть хоть один ингредиент с is_stopped=true — это каскад,
    // и затемнять всю карточку не нужно (визуально пометим только конкретные
    // ингредиенты ниже). Ручной стоп блюда (без стопнутых ингредиентов) —
    // карточка целиком становится серой как раньше.
    const hasStoppedIngredient = dish.ingredients.some(dishIng => {
        const ingBase = ingredients.find(i => i.id === dishIng.id);
        return ingBase?.is_stopped === true;
    });
    const greyOutWholeCard = isStopped && !hasStoppedIngredient;

    const isMerged = order.quantity_stack.length === 1;
    const totalQty = order.quantity_stack.reduce((sum, q) => sum + q, 0);
    const stackString = order.quantity_stack.join(' + ');

    // Формула времени (миграция 019 — Вариант Б):
    //   elapsed = (pivot - created_at) - accumulated_time_ms
    //   где pivot = parked_at если PARKED (таймер «на паузе»), иначе now.
    //
    // Семантика accumulated_time_ms — «общее время, проведённое в парковке»,
    // поэтому вычитаем его из общего «часов от создания». Для новых заказов
    // accumulated = 0 → elapsed = now - created_at, как и было.
    // Для заказа вернувшегося из ручной парковки (created_at остался ordertime,
    // accumulated = сколько был в парковке) — elapsed корректно исключит парковку.
    // Для десерта после автопарковки (created_at сдвинут на unpark_at, accumulated = 0)
    // — elapsed = now - unpark_at, таймер с нуля.
    const pivot = order.status === 'PARKED' && order.parked_at
      ? order.parked_at
      : now;
    const timeElapsed = Math.max(0, (pivot - order.created_at) - (order.accumulated_time_ms || 0));

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // --- Styles ---
    let borderClass = "border-slate-700";
    if (dish.priority_flag === PriorityLevel.ULTRA) {
        borderClass = "border-red-500 shadow-glow-red";
    } else {
        const isVipCategory = dish.category_ids?.some(id => {
            const cat = categories.find(c => c.id === id);
            return cat?.name.toLowerCase() === 'vip';
        });
        if (isVipCategory) {
            borderClass = "border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]";
        }
    }

    // «В работе» — светло-неоновый зелёный бордер, overrides ULTRA/VIP.
    // Делаем ярче чем VIP но светлее чем ULTRA-красный — отличимо с 3 метров.
    if (isInWork) {
        borderClass = "border-lime-400 shadow-[0_0_20px_rgba(163,230,53,0.7)]";
    }

    // --- Scroll Logic (> 5 Ingredients) ---
    const itemCount = dish.ingredients.length;
    const isScrollable = itemCount > 5;

    const listRef = useRef<HTMLDivElement>(null);
    const [isScrolledToBottom, setIsScrolledToBottom] = useState(!isScrollable); // If not scrollable, considered "at bottom"
    const [showScrollIndicator, setShowScrollIndicator] = useState(isScrollable);

    useEffect(() => {
        // Reset state if inputs change significantly
        if (!isScrollable) {
            setIsScrolledToBottom(true);
            setShowScrollIndicator(false);
        } else {
            setIsScrolledToBottom(false);
            setShowScrollIndicator(true);
            // Force check initial state? usually assumes start at top.
        }
    }, [dish.id, isScrollable]);

    const handleScroll = () => {
        if (!isScrollable || !listRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = listRef.current;
        // Check if near bottom (< 10px)
        const atBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 15;

        if (atBottom) {
            setIsScrolledToBottom(true);
            setShowScrollIndicator(false);
        } else {
            // Optional: re-enable button lock if user scrolls up? 
            // Requirement said "Разблокировка происходит только когда... запоминается"
            // So we generally don't re-lock if they scroll up, unless desired.
            // But let's verify: "Scroll to Accept" usually means ONCE they touch bottom, it's valid.
        }
    };

    // Determine button state
    // Blocked if: Is merged AND (Scrollable AND Not Scrolled to Bottom)
    // Also blocked if not merged (but that is separate logic)
    const canAction = !isScrollable || isScrolledToBottom;

    return (
        <div
            onClick={handleCardTap}
            className={`
        bg-kds-card rounded-lg flex flex-col justify-between overflow-hidden
        border-2 ${borderClass} transition-all duration-300 relative
        h-auto cursor-pointer
      `}
        >
            {/* Card Content */}
            <div className={`flex flex-col flex-1 p-4 pb-0 ${greyOutWholeCard ? 'opacity-60 grayscale' : ''} overflow-hidden`}>
                {/* Header Row */}
                <div className="flex justify-between items-start mb-2 shrink-0">
                    <div className="w-3/4 mr-2">
                        <h2 className="text-white font-bold text-lg leading-tight flex items-center flex-wrap gap-2">
                            {dish.name}

                            {/* ULTRA BADGE */}
                            {dish.priority_flag === PriorityLevel.ULTRA && (
                                <span className="text-red-500 border border-red-500 text-[10px] px-1 rounded -rotate-6 font-black tracking-widest shadow-[0_0_10px_rgba(239,68,68,0.6)] bg-red-500/10 animate-pulse select-none">
                                    ULTRA
                                </span>
                            )}

                            {/* VIP / Category Badge */}
                            {(() => {
                                const assignedCats = dish.category_ids
                                    ?.map(id => categories.find(c => c.id === id))
                                    .filter((c): c is Category => !!c)
                                    .sort((a, b) => a.sort_index - b.sort_index);

                                const primary = assignedCats?.[0];
                                const isVip = primary?.name.toLowerCase() === 'vip';

                                return primary ? (
                                    <span className={`text-[9px] font-bold uppercase tracking-widest border px-1 -rotate-2 rounded-sm select-none opacity-80
                    ${isVip
                                            ? 'text-yellow-400 border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)] bg-yellow-400/10'
                                            : 'text-slate-500 border-slate-600 opacity-60'
                                        }`}>
                                        {primary.name}{assignedCats.length > 1 && '+'}
                                    </span>
                                ) : null;
                            })()}
                        </h2>

                        {/* Table Numbers */}
                        {order.table_stack && order.table_stack.length > 0 && (
                            <div className="text-xs mt-1 font-medium flex flex-wrap gap-1 items-center">
                                <span className="text-slate-400 mr-1">столы:</span>
                                {order.table_stack.map((tables, blockIdx) => (
                                    <React.Fragment key={blockIdx}>
                                        {blockIdx > 0 && <span className="text-slate-500 mx-0.5">+</span>}
                                        {tables.map((num, tIdx) => {
                                            const isParked = order.parked_tables
                                                ? order.parked_tables.includes(num)
                                                : !!order.was_parked; // Fallback

                                            return (
                                                <React.Fragment key={tIdx}>
                                                    {tIdx > 0 && <span className="text-slate-500 mr-1">,</span>}
                                                    {isParked ? (
                                                        <span className="text-purple-300 bg-purple-900/40 px-1.5 py-0.5 rounded border border-purple-500/50">
                                                            {num}
                                                        </span>
                                                    ) : (
                                                        <span className="text-yellow-400 font-bold">
                                                            {num}
                                                        </span>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col items-end shrink-0 gap-1">
                        <div className="flex items-center text-slate-400 font-mono text-sm">
                            <Clock size={14} className="mr-1" />
                            {formatTime(timeElapsed)}
                        </div>
                        {/* ❄️ Разморозка — три визуальных состояния:
                            1) Ожидание: dish.requires_defrost && !hasDefrostBeenStarted
                               → синяя кликабельная кнопка «запустить разморозку»
                            2) Разморожено: dish.requires_defrost && hasDefrostBeenStarted
                               → статичная серая ❄️, просто индикатор
                            3) В процессе: эта карточка сюда не попадает — она
                               отрисовывается как мини-карточка в DefrostRow */}
                        {dish.requires_defrost && (
                            hasDefrostBeenStarted(order) ? (
                                <div
                                    className="text-slate-500 flex items-center"
                                    title="Это блюдо прошло разморозку"
                                >
                                    <Snowflake size={27} />
                                </div>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onStartDefrost?.(order.id);
                                    }}
                                    className="p-2 rounded bg-blue-900/30 hover:bg-blue-800/60 text-blue-300 border border-blue-700/50 transition-colors"
                                    title="Запустить разморозку"
                                    aria-label="Запустить разморозку"
                                >
                                    <Snowflake size={27} className="animate-pulse" />
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Stack Badge */}
                <div className="mb-4 flex items-center gap-4 shrink-0">
                    <button
                        onClick={() => !isMerged && onStackMerge(order.id)}
                        disabled={isMerged}
                        className={`
                 inline-flex items-center justify-center px-2 py-0 rounded bg-slate-700/80 border-2
                 font-mono text-3xl font-black leading-none
                 ${isMerged
                    ? 'text-cyan-300 border-slate-500'
                    : 'text-green-400 border-slate-600 animate-pulse cursor-pointer hover:bg-slate-700 hover:border-green-500'}
              `}
                    >
                        {isMerged ? totalQty : stackString}
                    </button>

                    {/* «В работе» — смайлик ножа рядом с количеством порций. */}
                    {isInWork && (
                        <span
                            className="text-2xl select-none drop-shadow-[0_0_6px_rgba(163,230,53,0.8)]"
                            title="В работе"
                            aria-label="В работе"
                        >
                            🔪
                        </span>
                    )}

                    {!isMerged && (
                        <MoveLeft
                            size={48}
                            className="text-red-500 animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.8)] ml-4 scale-x-150 origin-right"
                            strokeWidth={1.5}
                        />
                    )}
                </div>

                {/* Ingredients List */}
                <div className="flex-1 relative min-h-0 flex flex-col">
                    {/* Scroll Overlay Indicator (Bottom) - Only if scrollable and not at bottom */}
                    {showScrollIndicator && !isScrolledToBottom && (
                        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-10 flex items-end justify-center pb-2">
                            <ChevronDown className="text-green-500 animate-bounce drop-shadow-[0_0_10px_rgba(34,197,94,1)]" size={32} strokeWidth={3} />
                        </div>
                    )}

                    <div
                        ref={listRef}
                        onScroll={handleScroll}
                        className={`
               pr-1 custom-scrollbar pb-2
               ${isScrollable ? 'overflow-y-auto' : 'overflow-visible'}
            `}
                        style={isScrollable ? { maxHeight: '290px' } : {}}
                    >
                        <div className="space-y-2">
                            {dish.ingredients.map((dishIng, idx) => {
                                const ingBase = ingredients.find(i => i.id === dishIng.id);
                                if (!ingBase) return null;

                                const imageToUse = ingBase.imageUrl || dish.image_url;

                                // Smart Stacking Logic
                                let quantityDisplay = '';
                                const isStack = order.quantity_stack.length > 1;

                                if (isStack) {
                                    const splitValues = order.quantity_stack.map(q => {
                                        const val = dishIng.quantity * q;
                                        return ingBase.unitType === 'piece' ? `${val}` : `${val}g`;
                                    });
                                    quantityDisplay = splitValues.join(' + ');
                                    if (ingBase.unitType === 'piece') quantityDisplay += ' шт';
                                } else {
                                    const val = dishIng.quantity * totalQty;
                                    quantityDisplay = ingBase.unitType === 'piece'
                                        ? `${val} шт`
                                        : `${val}г`;
                                }

                                const ingStopped = ingBase.is_stopped === true;

                                return (
                                    <div
                                      key={idx}
                                      className={`flex items-center bg-slate-800/50 p-2 rounded text-sm border ${ingStopped ? 'border-red-500 grayscale opacity-60' : 'border-slate-700/50'}`}
                                    >
                                        {imageToUse ? (
                                            <div className="w-8 h-8 rounded bg-slate-700 mr-3 flex-shrink-0 overflow-hidden cursor-zoom-in"
                                                onDoubleClick={() => onPreviewImage(imageToUse)}>
                                                <img src={imageToUse} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded bg-slate-700 mr-3 flex-shrink-0 flex items-center justify-center text-[10px] text-slate-500">
                                                img
                                            </div>
                                        )}
                                        <span className="text-slate-200 font-medium flex-1 leading-snug">{ingBase.name}</span>
                                        <span className="text-yellow-400 font-bold ml-2 font-mono whitespace-nowrap">
                                            {quantityDisplay}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Actions */}
            <div className="p-4 pt-0 mt-auto shrink-0 bg-kds-card z-20">
                {/* STOP Banner always shows if stopped */}
                {isStopped && (
                    <div className="bg-slate-900/90 p-2 text-center border-t border-slate-700 backdrop-blur-sm mb-2">
                        <span className="text-red-400 text-xs font-bold flex items-center justify-center gap-2 animate-pulse">
                            <AlertTriangle size={14} />
                            СТОП: {stopReason}
                        </span>
                    </div>
                )}

                <div className="flex gap-2 h-12">
                    {/* Part Done Button - ALWAYS VISIBLE if quantity > 1 */}
                    <button
                        disabled={!canAction || totalQty <= 1}
                        onClick={() => onPartialComplete?.(order.id, 1)}
                        className={`
                            px-4 rounded font-bold transition-all flex items-center justify-center border
                            ${!canAction
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border-slate-700'
                                : (totalQty > 1
                                    ? 'bg-indigo-900/60 hover:bg-indigo-800 border-indigo-700 text-indigo-200'
                                    : 'bg-slate-900 text-slate-700 border-slate-800 cursor-not-allowed')}
                        `}
                        title={!canAction ? "Прокрутите список до конца" : "Частичное выполнение"}
                    >
                        <PieChart size={20} />
                    </button>

                    {/* Middle Area: Merge Warning OR Done Button */}
                    {!isMerged ? (
                        <div className="flex-1 bg-slate-800/80 p-2 rounded text-center border border-slate-700 flex items-center justify-center">
                            <span className="text-red-400 font-bold text-xs uppercase animate-pulse">
                                ЕЩЁ ЗАКАЗ (ОБЪЕДИНИТЕ ИХ)
                            </span>
                        </div>
                    ) : (
                        /* Done Button - Only if merged */
                        <button
                            disabled={!canAction}
                            onClick={() => onCompleteOrder(order.id)}
                            className={`
                                flex-1 rounded font-bold transition-all flex items-center justify-center uppercase tracking-wider
                                ${!canAction
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border-slate-700'
                                    : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20'}
                            `}
                        >
                            {!canAction ? (
                                <span className="flex items-center gap-2 text-xs">
                                    <ChevronDown size={14} className="animate-bounce" /> Пролистайте
                                </span>
                            ) : (
                                <>
                                    <Check size={20} className="mr-2 stroke-[3]" /> {completeButtonLabel ?? 'ГОТОВО'}
                                </>
                            )}
                        </button>
                    )}

                    {/* On Stop Button - Moved to Right */}
                    {isStopped && (
                        <button
                            onClick={() => onCancelOrder?.(order.id)}
                            className="px-3 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-1 transition-all rounded shadow-lg shadow-red-900/20"
                            title="Отменить заказ (На стопе)"
                        >
                            <X size={16} /> На стопе
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export const OrderCard = React.memo(OrderCardBase);
