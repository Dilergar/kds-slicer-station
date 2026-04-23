/**
 * PartialCompletionModal.tsx — Модальное окно частичного выполнения заказа
 *
 * Numpad-интерфейс для ввода количества порций для частичного завершения.
 * Позволяет повару выполнить часть заказа (например, 2 из 5 порций).
 * Оставшиеся порции остаются в активных заказах на доске.
 */

import React, { useState } from 'react';
import { X, Check, Delete } from 'lucide-react';

interface PartialCompletionModalProps {
    totalQty: number;
    onConfirm: (qty: number) => void;
    onClose: () => void;
}

export const PartialCompletionModal: React.FC<PartialCompletionModalProps> = ({ totalQty, onConfirm, onClose }) => {
    const [value, setValue] = useState<string>('');

    const handleNumClick = (num: number) => {
        const newVal = value + num.toString();
        if (parseInt(newVal) < totalQty) {
            setValue(newVal);
        }
    };

    const handleBackspace = () => {
        setValue(prev => prev.slice(0, -1));
    };

    const handleConfirm = () => {
        const qty = parseInt(value);
        if (qty > 0 && qty < totalQty) {
            onConfirm(qty);
        }
    };

    const currentQty = value ? parseInt(value) : 0;
    const isValid = currentQty > 0 && currentQty < totalQty;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">

                {/* Header */}
                <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
                    <h3 className="text-xl font-bold text-white">Частичная отдача</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                {/* Display */}
                <div className="p-6 flex flex-col items-center gap-2 bg-slate-800/50">
                    <div className="text-slate-400 text-sm uppercase font-bold tracking-wider">Количество к отдаче</div>
                    <div className="text-5xl font-mono font-bold text-blue-400 h-16 flex items-center">
                        {value || <span className="text-slate-600">0</span>}
                        <span className="text-slate-500 text-2xl ml-2 font-normal">/ {totalQty}</span>
                    </div>
                </div>

                {/* Numpad */}
                <div className="p-4 grid grid-cols-3 gap-2 bg-slate-900">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button
                            key={num}
                            onClick={() => handleNumClick(num)}
                            className="h-16 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-2xl font-bold transition-colors border border-slate-700"
                        >
                            {num}
                        </button>
                    ))}

                    {/* Bottom Row */}
                    <button
                        onClick={() => setValue('')} // Clear
                        className="h-16 rounded-lg bg-slate-800 hover:bg-red-900/30 text-red-400 font-bold transition-colors border border-slate-700 flex items-center justify-center"
                    >
                        ОЧИСТИТЬ
                    </button>

                    <button
                        onClick={() => handleNumClick(0)}
                        className="h-16 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-2xl font-bold transition-colors border border-slate-700"
                    >
                        0
                    </button>

                    <button
                        onClick={handleBackspace}
                        className="h-16 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700 flex items-center justify-center"
                    >
                        <Delete size={24} />
                    </button>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-slate-700 bg-slate-800">
                    <button
                        onClick={handleConfirm}
                        disabled={!isValid}
                        className={`w-full py-4 rounded-lg font-bold text-lg uppercase tracking-wider flex items-center justify-center gap-2 transition-all
               ${isValid
                                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-blue-500/20'
                                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                    >
                        <Check size={24} strokeWidth={3} />
                        Подтвердить отдачу
                    </button>
                </div>

            </div>
        </div>
    );
};
