import { StopHistoryEntry } from '../../types';

export interface DashboardHistoryEntry extends StopHistoryEntry {
  isActive?: boolean;
}

export interface DateGroup {
  dateStr: string;
  totalDuration: number;
  stopCount: number;
  entries: DashboardHistoryEntry[];
}

export interface HistoryGroup {
  name: string;
  isActive: boolean;
  entries: DashboardHistoryEntry[];
  totalDuration: number;
  stopCount: number;
  dates: Record<string, DateGroup>;
}

export type SortField = 'name' | 'cycles' | 'time';
export type SortDirection = 'asc' | 'desc';

/**
 * Сколько миллисекунд из [periodStart; periodEnd] попадает в бизнес-часы
 * ресторана (openTime→closeTime каждый день, пропуская excludedDates).
 * Поддерживает overnight-смены (например, 22:00→06:00).
 *
 * Цикл перебирает период по дням. MAX_DAYS должен покрывать реалистичные
 * годовые/многолетние отчёты. Если кто-то поставит период больше —
 * функция вернёт усечённый результат и напишет warning в консоль (а не
 * молча наврёт, как было с `safety < 1000` = 2.7 года).
 */
const MAX_DAYS_IN_OVERLAP = 20000; // ~55 лет
export function calculateBusinessOverlap(
  periodStart: number,
  periodEnd: number,
  openTimeStr: string,
  closeTimeStr: string,
  excludedDates: string[] = []
): number {
  if (periodEnd <= periodStart) return 0;

  const [openH, openM] = openTimeStr.split(':').map(Number);
  const [closeH, closeM] = closeTimeStr.split(':').map(Number);

  const iterDate = new Date(periodStart);
  iterDate.setHours(0, 0, 0, 0);

  const endTarget = new Date(periodEnd);
  let totalOverlap = 0;
  let safety = 0;

  while (iterDate < endTarget && safety < MAX_DAYS_IN_OVERLAP) {
    safety++;
    const dateStr = `${iterDate.getFullYear()}-${String(iterDate.getMonth() + 1).padStart(2, '0')}-${String(iterDate.getDate()).padStart(2, '0')}`;

    if (excludedDates.includes(dateStr)) {
      iterDate.setDate(iterDate.getDate() + 1);
      continue;
    }

    const intervals = [];

    if (openH < closeH || (openH === closeH && openM < closeM)) {
      const startBusiness = new Date(iterDate);
      startBusiness.setHours(openH, openM, 0, 0);

      const endBusiness = new Date(iterDate);
      endBusiness.setHours(closeH, closeM, 0, 0);

      intervals.push({ start: startBusiness.getTime(), end: endBusiness.getTime() });
    } else {
      const startMorning = new Date(iterDate);
      startMorning.setHours(0, 0, 0, 0);
      const endMorning = new Date(iterDate);
      endMorning.setHours(closeH, closeM, 0, 0);

      if (endMorning > startMorning) {
        intervals.push({ start: startMorning.getTime(), end: endMorning.getTime() });
      }

      const startEvening = new Date(iterDate);
      startEvening.setHours(openH, openM, 0, 0);
      const endEvening = new Date(iterDate);
      endEvening.setHours(23, 59, 59, 999);

      if (endEvening > startEvening) {
        intervals.push({ start: startEvening.getTime(), end: endEvening.getTime() + 1 });
      }
    }

    for (const interval of intervals) {
      const overlapStart = Math.max(periodStart, interval.start);
      const overlapEnd = Math.min(periodEnd, interval.end);

      if (overlapEnd > overlapStart) {
        totalOverlap += (overlapEnd - overlapStart);
      }
    }

    iterDate.setDate(iterDate.getDate() + 1);
  }

  if (safety >= MAX_DAYS_IN_OVERLAP) {
    // Период превысил лимит итераций — результат усечён. Пишем один раз
    // в консоль чтобы разработчик видел. В UI % и шкалы будут недостоверны.
    console.warn(
      `[calculateBusinessOverlap] Период превысил ${MAX_DAYS_IN_OVERLAP} дней, ` +
      `результат усечён. Увеличьте MAX_DAYS_IN_OVERLAP или сузьте период.`
    );
  }

  return totalOverlap;
}

/**
 * Слияние пересекающихся или смежных интервалов [stoppedAt; resumedAt].
 * Возвращает массив непересекающихся [start, end] отсортированных по start.
 *
 * Зачем: в БД бывают «дубли» — два стопа на одно блюдо с разницей в секунды
 * (например, ctlg15_dishes имеет два UUID с одинаковым именем, кассир
 * ставит оба). Простая сумма durationMs при этом удваивает время простоя.
 * Union интервалов показывает ФАКТИЧЕСКОЕ время когда блюдо было на стопе.
 *
 * Алгоритм стандартный: sort по left, слияние соседей если left_next ≤ right_cur.
 * O(n log n) — для сотен стопов в группе мгновенно.
 */
export function mergeIntervals(entries: Array<{ stoppedAt: number; resumedAt: number }>): Array<[number, number]> {
  if (entries.length === 0) return [];
  const sorted = entries
    .map(e => [e.stoppedAt, e.resumedAt] as [number, number])
    .filter(([a, b]) => b > a)         // Защита от кривых данных (resumedAt <= stoppedAt)
    .sort((a, b) => a[0] - b[0]);

  if (sorted.length === 0) return [];

  const merged: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= last[1]) {
      // Пересекаются или касаются → расширяем правую границу до максимальной.
      last[1] = Math.max(last[1], nextEnd);
    } else {
      merged.push([nextStart, nextEnd]);
    }
  }
  return merged;
}

/** Сумма миллисекунд по union интервалов (без бизнес-часов). */
export function sumMergedMs(entries: Array<{ stoppedAt: number; resumedAt: number }>): number {
  return mergeIntervals(entries).reduce((sum, [a, b]) => sum + (b - a), 0);
}

export const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${day}.${month}.${year}, ${hours}:${minutes}:${seconds}`;
};

/**
 * Форматирует длительность в человекочитаемом виде.
 * Раньше возвращало только «мин, сек» — для стопа на 25 часов выводило
 * «1500 мин, 0 сек», для годового totalDuration — совсем нечитаемо.
 * Теперь добавляет дни и часы, убирает нулевые юниты из середины.
 *
 * Примеры:
 *   500ms          → "0 сек"
 *   90_000         → "1 мин 30 сек"
 *   3_900_000      → "1 ч 5 мин"
 *   90_000_000     → "1 д 1 ч"
 */
export const formatDuration = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days   = Math.floor(totalSec / 86400);
  const hours  = Math.floor((totalSec % 86400) / 3600);
  const mins   = Math.floor((totalSec % 3600) / 60);
  const secs   = totalSec % 60;

  // Показываем крупнейшие 2 ненулевые единицы — компактно и читаемо.
  // Для totalDuration в годовом отчёте это будет "120 д 4 ч", для короткого
  // стопа — "3 мин 15 сек".
  if (days > 0)  return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${mins} мин`;
  if (mins > 0)  return `${mins} мин ${secs} сек`;
  return `${secs} сек`;
};

export const formatWeight = (grams: number) => {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
  return `${grams} g`;
};
