import React from 'react';
import { AlertCircle, Trash2, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Удалить",
  cancelText = "Отмена"
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] bg-black/70 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200 p-4">
      <div 
        className="bg-slate-900 border border-red-900/50 rounded-xl shadow-2xl overflow-hidden max-w-md w-full animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-red-950/30 p-6 flex flex-col items-center border-b border-red-900/40">
          <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mb-4 text-red-500 shadow-inner">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-white text-center">{title}</h2>
        </div>
        
        {/* Body */}
        <div className="p-6">
          <p className="text-gray-300 text-center mb-8">
            {description}
          </p>
          
          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors border border-slate-700 flex items-center justify-center gap-2"
            >
              <X size={18} />
              {cancelText}
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold transition-all shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transform active:scale-95"
            >
              <Trash2 size={18} />
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
