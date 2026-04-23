/**
 * DefrostModal.tsx — Модалка для подтверждения «Разморозилась» вручную.
 *
 * Переиспользует стандартный OrderCard (без хаков и клонов): тот же вид
 * что нарезчик видит на доске, только:
 *   - зелёная кнопка в футере подписана «РАЗМОРОЗИЛАСЬ» (через completeButtonLabel)
 *   - onCompleteOrder вызывает handleCompleteDefrost, а не обычное завершение
 *   - ❄️-кнопка в шапке скрыта (onStartDefrost не прокидывается) — разморозка
 *     уже идёт, запускать заново смысла нет
 *
 * Остальной функционал карточки (Part Done / Merge / Cancel / стоп-баннер)
 * продолжает работать как на доске — если нарезчик решит частично закрыть
 * заказ прямо отсюда, это тоже валидный сценарий.
 */
import React from 'react';
import { Order, Dish, Category, IngredientBase } from '../types';
import { OrderCard } from './OrderCard';
import { X } from 'lucide-react';

interface DefrostModalProps {
  order: Order;
  dish: Dish;
  categories: Category[];
  ingredients: IngredientBase[];
  now: number;
  onClose: () => void;
  onConfirmDefrosted: (orderId: string) => void;
  onCompleteOrder: (orderId: string) => void;
  onStackMerge: (orderId: string) => void;
  onPartialComplete?: (orderId: string, quantity: number) => void;
  onCancelOrder?: (orderId: string) => void;
  onPreviewImage: (url: string) => void;
}

export const DefrostModal: React.FC<DefrostModalProps> = ({
  order,
  dish,
  categories,
  ingredients,
  now,
  onClose,
  onConfirmDefrosted,
  onCompleteOrder,
  onStackMerge,
  onPartialComplete,
  onCancelOrder,
  onPreviewImage,
}) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="bg-kds-card rounded-lg w-full max-w-md max-h-[90vh] flex flex-col border border-blue-700/50 shadow-2xl relative overflow-hidden">
        {/* Шапка модалки: крестик и подпись «Разморозка» */}
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={onClose}
            className="p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Закрыть (разморозка продолжится)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Основной OrderCard — тот же что на доске, только:
            - completeButtonLabel='РАЗМОРОЗИЛАСЬ' (большая зелёная кнопка в футере)
            - onCompleteOrder перенаправлен на подтверждение разморозки
            - onStartDefrost не прокинут — ❄️ в шапке не отрисуется
            - onToggleInWork не прокинут — тап по карточке ничего не делает
              (чтобы случайный тап не захламил state) */}
        <div className="overflow-y-auto">
          <OrderCard
            order={order}
            dish={dish}
            categories={categories}
            ingredients={ingredients}
            now={now}
            completeButtonLabel="РАЗМОРОЗИЛАСЬ"
            onCompleteOrder={(id) => {
              onConfirmDefrosted(id);
              onClose();
            }}
            onStackMerge={onStackMerge}
            onPartialComplete={onPartialComplete}
            onCancelOrder={onCancelOrder}
            onPreviewImage={onPreviewImage}
          />
        </div>
      </div>
    </div>
  );
};
