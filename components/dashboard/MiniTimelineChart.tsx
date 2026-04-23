/**
 * MiniTimelineChart — маленькая гистограмма «где просадка».
 *
 * Рисует столбики одинаковой ширины, высота = среднее значение внутри
 * bucket'а (часа / дня / месяца). Пик выделяется акцентным цветом, пустые
 * bucket'ы — серым полупрозрачным. Без осей и сетки — стиль примера из
 * ТЗ: «12 15 18 21» под столбиками.
 *
 * Granularity выбирается автоматически по длине периода:
 *   ≤ 36 ч   → по часам
 *   ≤ 62 дня → по дням
 *   больше  → по месяцам
 *
 * Используется в SpeedKpiSection и ChefCookingSpeedSection. Компонент
 * generic: снаружи передают сырые entries {timestamp, value}, внутри
 * считается средняя. Единицы — любые (мс, штуки и т.д.), chart просто
 * нормализует к максимуму.
 */

import React, { useMemo } from 'react';
import { formatDuration } from './dashboardUtils';

type Granularity = 'hour' | 'day' | 'month';

export interface MiniTimelineEntry {
  timestamp: number;  // unix ms
  value: number;      // значение которое агрегируем (ср. время на порцию в мс)
}

/** Палитра столбиков под секцию (green = обычные, yellow = парковка, purple = готовка повара) */
type ColorKey = 'green' | 'yellow' | 'purple';

const COLORS: Record<ColorKey, { bar: string; peak: string; empty: string; label: string }> = {
  green:  { bar: 'bg-green-500/50',  peak: 'bg-green-400',  empty: 'bg-slate-700/30', label: 'text-green-400'  },
  yellow: { bar: 'bg-yellow-500/50', peak: 'bg-yellow-400', empty: 'bg-slate-700/30', label: 'text-yellow-400' },
  purple: { bar: 'bg-purple-500/50', peak: 'bg-purple-400', empty: 'bg-slate-700/30', label: 'text-purple-400' },
};

interface Props {
  entries: MiniTimelineEntry[];
  rangeStart: number;
  rangeEnd: number;
  color?: ColorKey;
  /** Подпись над диаграммой слева. По умолчанию — «Ср. время по периоду». */
  caption?: string;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** Выбор гранулярности по длине диапазона. */
function pickGranularity(rangeMs: number): Granularity {
  if (rangeMs <= 36 * HOUR) return 'hour';
  if (rangeMs <= 62 * DAY) return 'day';
  return 'month';
}

/**
 * Генерирует упорядоченный массив bucket'ов полностью покрывающих
 * диапазон. Каждый bucket несёт ключ (для группировки) и label
 * (для подписи оси X).
 */
function buildBuckets(rangeStart: number, rangeEnd: number, granularity: Granularity) {
  const buckets: Array<{ key: string; label: string; start: number }> = [];
  const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

  if (granularity === 'hour') {
    const d = new Date(rangeStart);
    d.setMinutes(0, 0, 0);
    while (d.getTime() <= rangeEnd) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
      buckets.push({ key, label: `${d.getHours()}`, start: d.getTime() });
      d.setHours(d.getHours() + 1);
    }
  } else if (granularity === 'day') {
    const d = new Date(rangeStart);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= rangeEnd) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      buckets.push({ key, label: `${d.getDate()}`, start: d.getTime() });
      d.setDate(d.getDate() + 1);
    }
  } else {
    const d = new Date(rangeStart);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= rangeEnd) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      buckets.push({ key, label: MONTH_NAMES[d.getMonth()], start: d.getTime() });
      d.setMonth(d.getMonth() + 1);
    }
  }

  return buckets;
}

/** Ключ bucket'а для entry-timestamp. Совпадает с формулой в buildBuckets. */
function entryBucketKey(ts: number, granularity: Granularity): string {
  const d = new Date(ts);
  if (granularity === 'hour') {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  }
  if (granularity === 'day') {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * Главный компонент. Не рисует оси — вся идея в том, чтобы столбики сами
 * говорили «здесь быстро», «здесь медленно». Для tooltip'а используем
 * стандартный HTML title — не тащим UI-зависимости ради минимализма.
 */
export const MiniTimelineChart: React.FC<Props> = ({
  entries,
  rangeStart,
  rangeEnd,
  color = 'green',
  caption,
}) => {
  const palette = COLORS[color];

  const { buckets, maxValue, granularity } = useMemo(() => {
    const gran = pickGranularity(rangeEnd - rangeStart);
    const bs = buildBuckets(rangeStart, rangeEnd, gran);

    // Группируем entries → сумма+count по ключу. avg = sum/count.
    const agg = new Map<string, { sum: number; count: number }>();
    for (const e of entries) {
      if (e.timestamp < rangeStart || e.timestamp > rangeEnd) continue;
      const k = entryBucketKey(e.timestamp, gran);
      const cur = agg.get(k) || { sum: 0, count: 0 };
      cur.sum += e.value;
      cur.count += 1;
      agg.set(k, cur);
    }

    // Склейка bucket ↔ агрегат.
    const filled = bs.map(b => {
      const a = agg.get(b.key);
      const avg = a && a.count > 0 ? a.sum / a.count : 0;
      return { ...b, avg, count: a?.count || 0 };
    });

    const maxV = filled.reduce((m, b) => Math.max(m, b.avg), 0);
    return { buckets: filled, maxValue: maxV, granularity: gran };
  }, [entries, rangeStart, rangeEnd]);

  // Когда данных нет вообще — рисуем placeholder, чтобы не скакала высота.
  if (buckets.length === 0 || maxValue === 0) {
    return (
      <div className="h-[88px] flex items-center justify-center text-slate-600 text-xs italic border border-dashed border-slate-800 rounded">
        Нет данных для графика
      </div>
    );
  }

  // Ось X: не показываем подпись под каждым столбиком — только через step,
  // чтобы не сливалось. Для ~24 bucket'ов step=3 даёт 8 меток, достаточно.
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <div className="w-full">
      {caption && (
        <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${palette.label}`}>
          {caption}
        </div>
      )}
      {/* Контейнер с явной высотой. Каждый bucket — relative-колонка,
          столбик внутри — absolute от нижней границы колонки. Это надёжнее
          чем flex items-end + процентная height на inner div'е — процентная
          height в flex-items работает только если у родителя явная высота,
          что на уровне колонок не гарантировано из-за min-w-0/flex-1. */}
      <div className="flex h-16 gap-0.5 items-stretch">
        {buckets.map((b) => {
          const heightPercent = b.avg > 0 ? (b.avg / maxValue) * 100 : 0;
          const isPeak = b.avg === maxValue && b.avg > 0;
          const tooltip = b.count > 0
            ? `${b.label} • ${b.count} зак. • ${formatDuration(b.avg)}`
            : `${b.label} • нет заказов`;
          return (
            <div key={b.key} className="flex-1 relative min-w-0" title={tooltip}>
              {b.avg > 0 ? (
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-sm transition-colors ${isPeak ? palette.peak : palette.bar}`}
                  style={{ height: `${Math.max(8, heightPercent)}%` }}
                />
              ) : (
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-sm ${palette.empty}`}
                  style={{ height: '6%' }}
                />
              )}
              <span className="sr-only">{b.label}: {b.avg > 0 ? formatDuration(b.avg) : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 mt-1">
        {buckets.map((b, idx) => (
          <div key={b.key} className="flex-1 text-[10px] text-slate-500 text-center font-mono min-w-0">
            {idx % labelStep === 0 ? b.label : ''}
          </div>
        ))}
      </div>
      {/* Hint снизу: что за гранулярность */}
      <div className="text-[10px] text-slate-600 mt-0.5 italic text-right">
        {granularity === 'hour' && 'по часам'}
        {granularity === 'day' && 'по дням'}
        {granularity === 'month' && 'по месяцам'}
      </div>
    </div>
  );
};
