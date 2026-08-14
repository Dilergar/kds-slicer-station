/**
 * ErrorBoundary.tsx — Предохранитель от «белого экрана» на кухонном планшете.
 *
 * Зачем: любое необработанное исключение при отрисовке размонтирует всё дерево
 * React, и нарезчик видит пустую страницу без единой кнопки. Смена длится 12
 * часов, планшет никто не перезагружает, и догадаться нажать F5 на кухне
 * некому — поэтому вместо пустоты показываем крупный экран с кнопкой.
 *
 * Ловит только ошибки рендера дочернего дерева (это ограничение самого React);
 * ошибки в обработчиках событий и в промисах сюда не попадают — за них отвечают
 * try/catch на местах.
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  /** Текст ошибки для показа техподдержке; null = всё в порядке */
  message: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { message: null };
  }

  /**
   * Переводит компонент в состояние ошибки при исключении в дочернем дереве.
   * @param error — то, что бросил рендер
   * @returns новый стейт с текстом ошибки
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { message: error?.message || 'Неизвестная ошибка' };
  }

  /**
   * Логирует детали в консоль — на планшете её посмотреть некому,
   * но при разборе жалобы через удалёнку это единственный след.
   */
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Необработанная ошибка рендера:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <div className="h-screen w-full bg-kds-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center bg-red-600 p-4 rounded-2xl shadow-lg shadow-red-900/40 mb-5">
            <AlertTriangle className="text-white w-9 h-9" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Что-то пошло не так</h1>
          <p className="text-slate-400 mb-6">
            Экран нужно перезагрузить. Данные заказов не потеряются — они хранятся на сервере.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-lg px-8 py-4 rounded-xl transition-colors"
          >
            <RotateCcw size={22} />
            Перезагрузить
          </button>
          <p className="text-xs text-slate-600 mt-8 font-mono break-words">{this.state.message}</p>
        </div>
      </div>
    );
  }
}
