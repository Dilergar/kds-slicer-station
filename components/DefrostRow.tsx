/**
 * DefrostRow.tsx — Ряд мини-карточек размораживающихся блюд.
 *
 * Отрисовывается в SlicerStation между заголовком «KDS Board» и основной
 * сеткой карточек. Горизонтальный flex-wrap, голубоватый фон — визуально
 * отделяет «зону разморозки» от обычной очереди.
 *
 * Мини-карточка показывает:
 *   ❄️  <Код блюда>  <Nшт>  <столы>  <обратный таймер MM:SS>  [×]
 *
 * Клик по мини-карточке (кроме крестика) → открывает DefrostModal с полной
 * карточкой блюда и кнопкой «Разморозилась». Крестик [×] сразу отменяет
 * разморозку без модалки.
 *
 * Звук готовности живёт НЕ здесь, а в SlicerStation (playDefrostBeep из
 * utils.ts): сюда попадают только АКТИВНЫЕ разморозки, истёкшая исчезает из
 * списка тем же тиком — компонент физически не может увидеть переход
 * «идёт → истёк», из-за чего старый эффект не срабатывал никогда.
 */
import React, { useState } from 'react';
import { Order, Dish } from '../types';
import { Snowflake, X, Check } from 'lucide-react';
import { isDefrostActive } from '../smartQueue';

interface DefrostRowProps {
  orders: Order[];
  dishes: Dish[];
  now: number;
  /** Клик по телу мини-карточки → открыть модалку */
  onOpenModal: (orderId: string) => void;
  /** Клик по красному крестику → отменить разморозку (вернуть в очередь с ULTRA) */
  onCancelDefrost: (orderId: string) => void;
  /** Клик по зелёной галочке → подтвердить «Разморозилось» (то же что кнопка в модалке) */
  onCompleteDefrost: (orderId: string) => void;
  /**
   * uuid текущего нарезчика (миграция 029) — чтобы отличить свой клейм от
   * чужого. Разморозка клейм не снимает, поэтому мини-карточка тоже
   * подписана: видно, кто вернётся к этой рыбе, когда таймер истечёт.
   */
  currentUserUuid?: string | null;
}

/**
 * Форматирует количество секунд в «MM:SS» для обратного таймера.
 * Отрицательное время (таймер уже истёк, мы ещё не успели убрать карточку
 * в этом рендере) отображается как «00:00», чтобы не мигать «-00:01».
 */
const formatCountdown = (secondsRemaining: number): string => {
  const s = Math.max(0, Math.floor(secondsRemaining));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
};

export const DefrostRow: React.FC<DefrostRowProps> = ({
  orders,
  dishes,
  now,
  onOpenModal,
  onCancelDefrost,
  onCompleteDefrost,
  currentUserUuid = null,
}) => {
  // Мини-карточки, по которым только что нажали. Первый тап убирает карточку
  // из ряда, оставшиеся сдвигаются влево — и второй тап «дребезга» попадал в
  // соседнее блюдо: досрочно закрывал чужую разморозку или отменял её.
  // Ключ — id заказа, поэтому блокировка переживает пересборку ряда.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  /**
   * Выполняет действие мини-карточки один раз, гася её на время перестроения ряда.
   * @param orderId — id заказа (виртуальный id группы разморозки)
   * @param fn — что выполнить
   */
  const guardTap = (orderId: string, fn: () => void) => {
    if (pendingIds.has(orderId)) return;
    setPendingIds(prev => new Set(prev).add(orderId));
    setTimeout(() => {
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }, 600);
    fn();
  };

  // Собираем все активно размораживающиеся заказы. В SlicerStation мы
  // работаем с уже готовыми Order[] (виртуальные группы Smart Wave),
  // поэтому здесь просто фильтруем по isDefrostActive.
  const defrostingOrders = orders.filter(o => isDefrostActive(o, now));

  if (defrostingOrders.length === 0) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-blue-950/30 border border-blue-900/50 shadow-inner">
      <div className="flex items-center gap-2 mb-2 text-blue-300 text-xs font-bold uppercase tracking-wider">
        <Snowflake size={14} />
        Разморозка
        <span className="bg-blue-900/60 px-2 py-0.5 rounded-full font-mono">{defrostingOrders.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {defrostingOrders.map(order => {
          const dish = dishes.find(d => d.id === order.dish_id);
          if (!dish) return null;

          const startedAt = order.defrost_started_at!;
          const durationSec = order.defrost_duration_seconds ?? 0;
          const elapsedSec = (now - startedAt) / 1000;
          const remainingSec = durationSec - elapsedSec;

          const totalQty = order.quantity_stack.reduce((a, b) => a + b, 0);
          const tables = order.table_stack.flat().filter(Boolean);

          // Показываем ТОЛЬКО код блюда (например «127»). Имя не дублируем —
          // карточка очень маленькая, а код однозначно идентифицирует блюдо
          // для нарезчика (он его видит на основной карточке и на чеке).
          // Если code почему-то пустой — показываем первое слово имени как
          // fallback (в имени уже есть префикс кода).
          const dishLabel = dish.code || dish.name.split(' ')[0];

          return (
            <button
              key={order.id}
              onClick={() => onOpenModal(order.id)}
              className="group relative bg-slate-900/80 hover:bg-slate-800 border border-blue-700/50 hover:border-blue-500 rounded-lg px-3 py-2 pr-12 text-left transition-all min-w-[190px]"
            >
              <div className="flex items-start gap-2">
                <Snowflake size={18} className="text-blue-300 shrink-0 mt-0.5 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-lg leading-tight font-mono">{dishLabel}</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {totalQty}шт{tables.length > 0 && <> · стол {tables.join(',')}</>}
                  </div>
                  <div className="text-lg font-mono font-black text-blue-200 mt-1 leading-none">
                    {formatCountdown(remainingSec)}
                  </div>
                  {/* Клейм «В работе» (миграция 029) — своя метка лаймовая,
                      чужая голубая, как на больших карточках. */}
                  {order.claimed_by_uuid && (
                    <div
                      className={`text-[11px] font-bold mt-1 leading-none truncate ${
                        order.claimed_by_uuid === currentUserUuid
                          ? 'text-lime-300'
                          : 'text-sky-300'
                      }`}
                      title={`В работе: ${order.claimed_by_name || 'нарезчик'}`}
                    >
                      🔪 {order.claimed_by_name || 'в работе'}
                    </div>
                  )}
                </div>
                {/* Крестик отмены разморозки — компактный красный кружок справа сверху. */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    guardTap(order.id, () => onCancelDefrost(order.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      guardTap(order.id, () => onCancelDefrost(order.id));
                    }
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white border border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-colors cursor-pointer"
                  title="Отменить разморозку"
                  aria-label="Отменить разморозку"
                >
                  <X size={14} strokeWidth={3} />
                </span>
                {/* Зелёная галочка «Разморозилось» — в 2 раза больше крестика (48 vs 24 px).
                    Под крестиком, справа. Основной способ ручного подтверждения: рыба
                    оттаяла раньше таймера → тап → карточка возвращается в очередь
                    мгновенно (тот же defrost-complete что в модалке). */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    guardTap(order.id, () => onCompleteDefrost(order.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      guardTap(order.id, () => onCompleteDefrost(order.id));
                    }
                  }}
                  className="absolute bottom-1.5 right-1.5 w-8 h-8 flex items-center justify-center rounded-full bg-green-600 hover:bg-green-500 text-white border border-green-400 shadow-[0_0_10px_rgba(34,197,94,0.6)] transition-colors cursor-pointer"
                  title="Разморозилось"
                  aria-label="Разморозилось"
                >
                  <Check size={18} strokeWidth={3} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
