/**
 * StopReasonModal.tsx — Модальное окно выбора причины стопа
 *
 * Позволяет выбрать причину остановки ингредиента/блюда:
 * Out of Stock, Spoilage, Kitchen Issue, Other (custom).
 * Используется в StopListManager и AdminPanel.
 */

import React, { useState } from 'react';
import { AlertOctagon } from 'lucide-react';

interface StopReasonModalProps {
    isOpen: boolean;
    itemName: string;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}

export const StopReasonModal: React.FC<StopReasonModalProps> = ({
    isOpen,
    itemName,
    onClose,
    onConfirm,
}) => {
    const [reason, setReason] = useState('Закончилось');
    const [customReason, setCustomReason] = useState('');
    const [validationError, setValidationError] = useState('');

    if (!isOpen) return null;

    const handleConfirm = () => {
        let finalReason = reason;
        if (reason === 'Other') {
            if (!customReason.trim()) {
                setValidationError('Пожалуйста, введите причину');
                return;
            }
            finalReason = customReason.trim();
        }
        onConfirm(finalReason);
    };

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]">
            <div className="bg-gray-800 p-6 rounded-lg w-96 border border-red-500/30 shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="flex items-center text-red-500 mb-4">
                    <AlertOctagon className="mr-2" />
                    <h3 className="text-lg font-bold text-white">Выбор Причины (Стоп)</h3>
                </div>

                <p className="text-gray-300 mb-4">Почему вы останавливаете <span className="text-white font-bold">{itemName}</span>?</p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                    {['Закончилось', 'Списание', 'Не доставили', 'Другое'].map((r) => (
                        <button
                            key={r}
                            onClick={() => {
                                setReason(r);
                                setValidationError('');
                            }}
                            className={`
                p-4 rounded-lg font-bold text-sm transition-all duration-200 border-2
                ${reason === r
                                    ? 'bg-red-600 border-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] transform scale-105'
                                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                                }
              `}
                        >
                            {r === 'Списание' ? 'Списание / Качество' : r}
                        </button>
                    ))}
                </div>

                {reason === 'Другое' && (
                    <div className="mb-4">
                        <input
                            type="text"
                            value={customReason}
                            onChange={(e) => {
                                setCustomReason(e.target.value);
                                setValidationError('');
                            }}
                            placeholder="Введите подробную причину (Обязательно)"
                            className={`w-full bg-gray-900 text-white p-3 rounded border outline-none
                   ${validationError ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-blue-500'}
                `}
                            autoFocus
                        />
                        {validationError && <p className="text-red-500 text-xs mt-1">{validationError}</p>}
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={handleConfirm} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded">
                        В СТОП-ЛИСТ
                    </button>
                    <button onClick={onClose} className="flex-1 bg-transparent border border-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded">
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
};
