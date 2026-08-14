/**
 * ClampedNumberInput.tsx — Числовое поле с ограничением диапазона,
 * которое НЕ мешает набирать значение.
 *
 * Зачем отдельный компонент. Прежние поля ограничивали значение на каждое
 * нажатие клавиши прямо в onChange:
 *
 *     onChange={e => setValue(Math.max(10, Math.min(3600, parseInt(e.target.value) || 600)))}
 *
 * Владелец хочет поставить «Шаг курса» = 60 вместо 600: выделяет содержимое,
 * набирает «6» — поле мгновенно превращается в «10», потому что 6 меньше
 * минимума. Дожимает «0» и получает 100 или 1020, смотря куда прыгнула каретка.
 * Ввести любое число, чьи первые цифры меньше минимума, физически нельзя,
 * а «правдоподобное» значение молча уезжает в БД и меняет поведение очереди.
 *
 * Здесь во время набора хранится сырая строка, а ограничение и сохранение
 * происходят при уходе из поля или по Enter — тот же приём, что уже применён
 * для минут авто-парковки десертов в CategoriesTab.
 */

import React, { useState, useEffect, useCallback } from 'react';

interface ClampedNumberInputProps {
  /** Текущее сохранённое значение */
  value: number;
  /** Нижняя граница включительно */
  min: number;
  /** Верхняя граница включительно */
  max: number;
  /** Шаг стрелок браузера */
  step?: number;
  /** Значение, которое подставляется если поле оставили пустым */
  fallback: number;
  /** Вызывается с уже ограниченным целым значением при коммите */
  onCommit: (value: number) => void;
  className?: string;
  'aria-label'?: string;
}

export const ClampedNumberInput: React.FC<ClampedNumberInputProps> = ({
  value,
  min,
  max,
  step,
  fallback,
  onCommit,
  className,
  'aria-label': ariaLabel,
}) => {
  // Черновик набора. Строка, а не число: во время ввода поле может быть
  // пустым или содержать промежуточное значение вне диапазона.
  const [draft, setDraft] = useState(String(value));

  // Внешнее изменение значения (перечитали настройки, правка с другого
  // планшета) подхватываем — но только когда пользователь не в процессе набора
  // именно этого значения.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  /** Ограничивает черновик диапазоном и отдаёт результат наверх */
  const commit = useCallback(() => {
    const parsed = parseInt(draft, 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    const clamped = Math.max(min, Math.min(max, safe));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }, [draft, fallback, min, max, value, onCommit]);

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      // Колесо мыши над числовым полем меняет значение незаметно для человека,
      // который просто прокручивает страницу — снимаем фокус
      onWheel={(e) => (e.target as HTMLInputElement).blur()}
      className={className}
    />
  );
};
