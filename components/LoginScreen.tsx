/**
 * LoginScreen.tsx — Экран ввода PIN при старте модуля.
 *
 * Планшетный интерфейс: 4 ячейки под PIN и numpad 3x4 (9 цифр + Clear + 0 + Backspace).
 * PIN автоматически отправляется на backend при вводе 4-й цифры — не нужна
 * отдельная кнопка «Войти». Неверный PIN → шейк + сброс.
 *
 * Источник истины — чужая таблица `users`. Фронт не знает ни одного PIN —
 * всё проверяется через POST /api/auth/login.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Lock, Delete, X } from 'lucide-react';
import { AuthUser } from '../types';

interface LoginScreenProps {
  /** Возвращает AuthUser при успехе, бросает при ошибке (неверный PIN или сеть). */
  onLogin: (pin: number) => Promise<AuthUser>;
}

const PIN_LENGTH = 4;

/**
 * Человеческий текст ошибки входа. Для нарезчика «неверный PIN» и «сервер лежит» —
 * это два разных действия (позвать коллегу против позвать айтишника), поэтому
 * сетевой сбой нельзя показывать тем же текстом, что и опечатку.
 * @param err — то, что бросил onLogin (apiFetch кидает Error с текстом от сервера,
 *              сам fetch при обрыве сети кидает TypeError)
 * @returns строка для показа под точками PIN
 */
function describeLoginError(err: unknown): string {
  if (err instanceof TypeError) return 'Нет связи с сервером';
  if (err instanceof Error) {
    // fetch в разных браузерах формулирует обрыв по-разному, ловим по подстроке
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return 'Нет связи с сервером';
    }
    // Backend лежит: прокси отдаёт свой 5xx с англоязычным телом
    // («Internal Server Error», «Bad Gateway»). Нарезчику это ни о чём не
    // говорит — переводим в понятное «сервер недоступен».
    if (/internal server error|bad gateway|service unavailable|gateway time-?out|HTTP 5\d\d/i.test(err.message)) {
      return 'Сервер недоступен — позовите техподдержку';
    }
    if (/too many|слишком много/i.test(err.message)) {
      return 'Слишком много попыток. Подождите минуту.';
    }
    return err.message;
  }
  return 'Ошибка входа';
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  // Сторож повторного запуска. Именно ref, а НЕ стейт isSubmitting в зависимостях:
  // раньше эффект зависел от isSubmitting и сам же его взводил первой строкой —
  // React из-за смены зависимости вызывал cleanup предыдущего запуска и ставил
  // cancelled=true ещё до ответа сервера. В результате при любой ошибке обе ветки
  // (показ сообщения и сброс флага) пропускались по этому признаку, isSubmitting
  // залипал в true навсегда, а на нём висит disabled всего нумпада — планшет
  // блокировался до F5 после первой же опечатки в PIN.
  const submittingRef = useRef(false);

  // Авто-submit когда набрали 4 цифры. Вынесено в useEffect чтобы не зависеть
  // от порядка: setPin сначала ставит стейт, потом этот эффект срабатывает
  // на следующий рендер — гарантируем актуальное значение pin.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || submittingRef.current) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');

    let cancelled = false;
    (async () => {
      try {
        await onLogin(parseInt(pin, 10));
        // При успехе App разрендерит LoginScreen — setState тут уже некому принять
      } catch (err) {
        if (cancelled) return;
        setError(describeLoginError(err));
        setShake(true);
        setPin('');
        // Сброс shake через 500мс, чтобы анимация могла повториться при следующей ошибке
        setTimeout(() => setShake(false), 500);
      } finally {
        // Флаг снимаем всегда, даже если эффект успели отменить — иначе следующий
        // ввод PIN не пройдёт сторож и экран снова окажется мёртвым.
        submittingRef.current = false;
        if (!cancelled) setIsSubmitting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, onLogin]);

  const handleDigit = useCallback((digit: string) => {
    if (isSubmitting) return;
    setError('');
    setPin(prev => (prev.length < PIN_LENGTH ? prev + digit : prev));
  }, [isSubmitting]);

  const handleBackspace = useCallback(() => {
    if (isSubmitting) return;
    setError('');
    setPin(prev => prev.slice(0, -1));
  }, [isSubmitting]);

  const handleClear = useCallback(() => {
    if (isSubmitting) return;
    setError('');
    setPin('');
  }, [isSubmitting]);

  // Поддержка физической клавиатуры (удобно в dev-режиме)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleDigit, handleBackspace, handleClear]);

  return (
    <div className="h-screen w-full bg-kds-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-900/40 mb-4">
            <Lock className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Экран Нарезки</h1>
          <p className="text-sm text-slate-400 mt-1">Введите ваш PIN-код</p>
        </div>

        {/* PIN dots */}
        <div
          className={`flex justify-center gap-4 mb-2 transition-transform ${shake ? 'animate-shake' : ''}`}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <div
                key={i}
                className={`
                  w-5 h-5 rounded-full border-2 transition-all duration-150
                  ${filled
                    ? (error ? 'bg-red-500 border-red-500' : 'bg-blue-500 border-blue-500')
                    : 'bg-transparent border-slate-600'}
                `}
              />
            );
          })}
        </div>

        {/* Error message */}
        <div className="h-6 flex items-center justify-center mb-6">
          {error && (
            <span className="text-red-400 text-sm font-medium">{error}</span>
          )}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <NumpadButton key={d} onClick={() => handleDigit(d)} disabled={isSubmitting}>
              {d}
            </NumpadButton>
          ))}
          <NumpadButton onClick={handleClear} disabled={isSubmitting} variant="muted">
            <X size={24} />
          </NumpadButton>
          <NumpadButton onClick={() => handleDigit('0')} disabled={isSubmitting}>
            0
          </NumpadButton>
          <NumpadButton onClick={handleBackspace} disabled={isSubmitting} variant="muted">
            <Delete size={24} />
          </NumpadButton>
        </div>
      </div>

      {/* Встроенная анимация shake — тут же, чтобы не плодить файлов стилей */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
};

interface NumpadButtonProps {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'muted';
  children: React.ReactNode;
}

const NumpadButton: React.FC<NumpadButtonProps> = ({ onClick, disabled, variant = 'default', children }) => {
  const base = 'h-16 rounded-xl font-bold text-2xl transition-all active:scale-95 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';
  const colors = variant === 'muted'
    ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
    : 'bg-slate-800 text-white hover:bg-slate-700';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${colors}`}>
      {children}
    </button>
  );
};
