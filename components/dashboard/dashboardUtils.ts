import { StopHistoryEntry, SystemSettings } from '../../types';

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

  let current = new Date(periodStart);
  const iterDate = new Date(current);
  iterDate.setHours(0, 0, 0, 0);

  const endTarget = new Date(periodEnd);
  let totalOverlap = 0;
  let safety = 0;

  while (iterDate < endTarget && safety < 1000) {
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

  return totalOverlap;
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

export const formatDuration = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (mins > 0) {
    return `${mins} мин, ${secs} сек`;
  }
  return `${secs} сек`;
};

export const formatWeight = (grams: number) => {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
  return `${grams} g`;
};
