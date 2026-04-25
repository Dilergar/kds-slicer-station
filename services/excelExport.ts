/**
 * services/excelExport.ts — экспорт сводки отчётов Dashboard в .xlsx.
 *
 * Архитектура:
 *  - Клиентская генерация (ExcelJS + file-saver), без обращения к backend.
 *    У фронта уже есть все агрегированные/отфильтрованные данные; backend
 *    не дублирует логику расчётов.
 *  - Каждая секция Dashboard (SpeedKpi, ChefCookingSpeed, StopListHistory)
 *    через `onDataReady` callback отдаёт сюда свою текущую агрегацию +
 *    состояние UI-фильтров.
 *  - На выходе — workbook с 5 листами (Сводка / История стопов / 3 скорости).
 *
 * Лист «История стопов» соблюдает текущие UI-фильтры (тип записи + режим
 * группировки + строка поиска). Листы скоростей всегда показывают полную
 * иерархию Категория → Блюдо → Порция через Excel outline groups (свёрнуто
 * по умолчанию, +/- слева).
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  DashboardHistoryEntry,
  calculateBusinessOverlap,
  formatDuration,
  mergeIntervals,
  sumMergedMs,
  getStorageRank,
  getStorageRankLabel,
} from '../components/dashboard/dashboardUtils';
import {
  OrderHistoryEntry,
  ChefCookingEntry,
  SystemSettings,
} from '../types';

// ───────────────────────────────────────────────────────────────────────────
// Типы payload-а (data feeds от секций Dashboard)
// ───────────────────────────────────────────────────────────────────────────

export interface AggregatedSpeedDishRow {
  id: string;
  dishName: string;
  totalCycles: number;
  avgTimeMs: number;
  orders: OrderHistoryEntry[];
}

export interface AggregatedSpeedCategoryRow {
  id: string;
  categoryName: string;
  totalCycles: number;
  avgTimeMs: number;
  dishes: AggregatedSpeedDishRow[];
}

export type AggregatedSpeedReport = AggregatedSpeedCategoryRow[];

export interface AggregatedChefDishRow {
  id: string;
  dishName: string;
  totalCycles: number;
  avgTimeMs: number;
  portions: ChefCookingEntry[];
}

export interface AggregatedChefCategoryRow {
  id: string;
  categoryName: string;
  totalCycles: number;
  avgTimeMs: number;
  dishes: AggregatedChefDishRow[];
}

export type AggregatedChefReport = AggregatedChefCategoryRow[];

export interface HistoryReport {
  /** Все entries после применения period+search+typeFilter — с активными. */
  entries: DashboardHistoryEntry[];
  groupMode: 'by-item' | 'by-date';
  targetTypeFilter: 'all' | 'dish' | 'ingredient';
  searchQuery: string;
  rangeStart: number;
  rangeEnd: number;
}

export interface ExportPayload {
  /** datetime-local строки от Dashboard фильтра. */
  filterRange: { start: string; end: string };
  settings: SystemSettings;
  speedStandard?: AggregatedSpeedReport;
  speedParked?: AggregatedSpeedReport;
  chefSpeed?: AggregatedChefReport;
  history?: HistoryReport;
}

// ───────────────────────────────────────────────────────────────────────────
// Утилиты
// ───────────────────────────────────────────────────────────────────────────

/** Имя файла: `Slicer_KDS_2026-04-01_по_2026-04-25.xlsx`. */
function buildFilename(range: { start: string; end: string }): string {
  const isoDate = (s: string) => (s ? s.slice(0, 10) : 'all');
  return `Slicer_KDS_${isoDate(range.start)}_по_${isoDate(range.end)}.xlsx`;
}

/** datetime-local → Date или null для пустых. */
function parseDateTimeLocal(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Жирный заголовок таблицы + автофильтр + frozen-row. */
function applyTableStyling(ws: ExcelJS.Worksheet, headerRowNum: number, totalCols: number) {
  const headerRow = ws.getRow(headerRowNum);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // slate-800
  };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: totalCols },
  };
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }];
}

/** Применяет zebra-striping и outlineLevel-стили (отступ + цвет фона). */
function styleByOutlineLevel(row: ExcelJS.Row, level: 0 | 1 | 2) {
  // Excel сам делает отступы по outlineLevel в группированных строках,
  // но цвета помогают визуально различать уровни даже когда группа развернута.
  if (level === 0) {
    row.font = { bold: true };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E7FF' }, // indigo-100
    };
  } else if (level === 1) {
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' }, // slate-100
    };
  }
  // level 2 — без фона (чистый белый)
}

// ───────────────────────────────────────────────────────────────────────────
// Лист 1: Сводка (KPI + топ-10)
// ───────────────────────────────────────────────────────────────────────────

function buildSummarySheet(wb: ExcelJS.Workbook, payload: ExportPayload): void {
  const ws = wb.addWorksheet('Сводка', {
    properties: { defaultColWidth: 25 },
  });
  ws.columns = [
    { width: 38 },
    { width: 22 },
    { width: 30 },
    { width: 30 },
    { width: 14 },
    { width: 16 },
  ];

  const start = parseDateTimeLocal(payload.filterRange.start);
  const end = parseDateTimeLocal(payload.filterRange.end);

  // Хедер с метаданными
  ws.addRow(['Slicer KDS — Сводка отчётов']);
  ws.getRow(1).font = { bold: true, size: 16 };
  ws.addRow([
    'Период с',
    start ? start : '',
    'по',
    end ? end : '',
  ]);
  ws.getCell('B2').numFmt = 'dd.mm.yyyy hh:mm';
  ws.getCell('D2').numFmt = 'dd.mm.yyyy hh:mm';

  if (start && end) {
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    ws.addRow(['Длительность периода', `${days} дн.`]);
  }
  ws.addRow([]);

  // === ОТДАЧА ===
  ws.addRow(['ОТДАЧА (нарезчик)']);
  const otdSection = ws.getRow(ws.lastRow!.number);
  otdSection.font = { bold: true, color: { argb: 'FF15803D' } };

  const allOrders = [
    ...(payload.speedStandard?.flatMap(c => c.dishes.flatMap(d => d.orders)) ?? []),
    ...(payload.speedParked?.flatMap(c => c.dishes.flatMap(d => d.orders)) ?? []),
  ];
  const totalOrders = allOrders.length;
  const totalPortions = allOrders.reduce((s, o) => s + o.totalQuantity, 0);
  const sumPrep = allOrders.reduce((s, o) => s + o.prepTimeMs, 0);
  const avgPrepPerPortion = totalPortions > 0 ? sumPrep / totalPortions : 0;

  const stdOrders = payload.speedStandard?.flatMap(c => c.dishes.flatMap(d => d.orders)) ?? [];
  const stdPortions = stdOrders.reduce((s, o) => s + o.totalQuantity, 0);
  const stdSumPrep = stdOrders.reduce((s, o) => s + o.prepTimeMs, 0);
  const avgStd = stdPortions > 0 ? stdSumPrep / stdPortions : 0;

  const parkOrders = payload.speedParked?.flatMap(c => c.dishes.flatMap(d => d.orders)) ?? [];
  const parkPortions = parkOrders.reduce((s, o) => s + o.totalQuantity, 0);
  const parkSumPrep = parkOrders.reduce((s, o) => s + o.prepTimeMs, 0);
  const avgPark = parkPortions > 0 ? parkSumPrep / parkPortions : 0;

  ws.addRow(['Всего заказов', totalOrders]);
  ws.addRow(['Всего порций', totalPortions]);
  ws.addRow(['Ср. время отдачи (на порцию)', formatDuration(avgPrepPerPortion)]);
  ws.addRow(['Ср. время отдачи (обычные)', formatDuration(avgStd)]);
  ws.addRow(['Ср. время отдачи (парковка)', formatDuration(avgPark)]);
  ws.addRow([]);

  // === ПОВАР ===
  ws.addRow(['ГОТОВКА ПОВАРА']);
  ws.getRow(ws.lastRow!.number).font = { bold: true, color: { argb: 'FF7E22CE' } };

  const allChef = payload.chefSpeed?.flatMap(c => c.dishes.flatMap(d => d.portions)) ?? [];
  const chefPortions = allChef.reduce((s, p) => s + p.quantity, 0);
  const chefSum = allChef.reduce((s, p) => s + p.cookTimeMs, 0);
  const avgChef = chefPortions > 0 ? chefSum / chefPortions : 0;

  ws.addRow(['Замеров готовки', allChef.length]);
  ws.addRow(['Всего порций (повар)', chefPortions]);
  ws.addRow(['Ср. время готовки (на порцию)', formatDuration(avgChef)]);
  ws.addRow([]);

  // === СТОПЫ ===
  ws.addRow(['СТОПЫ']);
  ws.getRow(ws.lastRow!.number).font = { bold: true, color: { argb: 'FFDC2626' } };

  if (payload.history) {
    const h = payload.history;
    const completed = h.entries.filter(e => !e.isActive);
    const active = h.entries.filter(e => e.isActive);
    const dishStops = h.entries.filter(e => e.ingredientName.startsWith('[DISH]'));
    const ingStops = h.entries.filter(e => !e.ingredientName.startsWith('[DISH]'));

    const totalDowntimeMs = sumMergedMs(h.entries);
    const businessMs = calculateBusinessOverlap(
      h.rangeStart,
      h.rangeEnd,
      payload.settings.restaurantOpenTime || '12:00',
      payload.settings.restaurantCloseTime || '23:59',
      payload.settings.excludedDates || []
    );
    const downtimePercent = businessMs > 0 ? Math.round((totalDowntimeMs / businessMs) * 100) : 0;

    ws.addRow(['Всего стопов (в периоде)', h.entries.length]);
    ws.addRow(['Активных сейчас', active.length]);
    ws.addRow(['Завершённых', completed.length]);
    ws.addRow(['Из них блюд', dishStops.length]);
    ws.addRow(['Из них ингредиентов', ingStops.length]);
    ws.addRow(['Суммарное время downtime', formatDuration(totalDowntimeMs)]);
    ws.addRow(['% downtime от рабочего времени', `${downtimePercent}%`]);
  } else {
    ws.addRow(['Данные истории стопов не доступны', '']);
  }
  ws.addRow([]);

  // === ТОП-10 САМЫХ МЕДЛЕННЫХ БЛЮД (ОТДАЧА) ===
  ws.addRow(['ТОП-10 САМЫХ МЕДЛЕННЫХ БЛЮД (отдача, по ср. времени на порцию)']);
  ws.getRow(ws.lastRow!.number).font = { bold: true };

  const topSpeedHeader = ws.addRow(['#', 'Категория', 'Блюдо', 'Кол-во', 'Ср. время']);
  topSpeedHeader.font = { bold: true };
  const allSpeedDishes: Array<{ cat: string; name: string; cycles: number; avgMs: number }> = [];
  for (const cat of payload.speedStandard ?? []) {
    for (const d of cat.dishes) allSpeedDishes.push({ cat: cat.categoryName, name: d.dishName, cycles: d.totalCycles, avgMs: d.avgTimeMs });
  }
  for (const cat of payload.speedParked ?? []) {
    for (const d of cat.dishes) allSpeedDishes.push({ cat: cat.categoryName, name: d.dishName, cycles: d.totalCycles, avgMs: d.avgTimeMs });
  }
  allSpeedDishes.sort((a, b) => b.avgMs - a.avgMs);
  const topSpeed = allSpeedDishes.slice(0, 10);
  topSpeed.forEach((d, i) => {
    ws.addRow([i + 1, d.cat, d.name, d.cycles, formatDuration(d.avgMs)]);
  });
  if (topSpeed.length === 0) ws.addRow(['', '', 'Нет данных за период']);
  ws.addRow([]);

  // === ТОП-10 САМЫХ МЕДЛЕННЫХ БЛЮД (ПОВАР) ===
  ws.addRow(['ТОП-10 САМЫХ МЕДЛЕННЫХ БЛЮД (готовка повара)']);
  ws.getRow(ws.lastRow!.number).font = { bold: true };

  const topChefHeader = ws.addRow(['#', 'Категория', 'Блюдо', 'Кол-во', 'Ср. время']);
  topChefHeader.font = { bold: true };
  const allChefDishes: Array<{ cat: string; name: string; cycles: number; avgMs: number }> = [];
  for (const cat of payload.chefSpeed ?? []) {
    for (const d of cat.dishes) allChefDishes.push({ cat: cat.categoryName, name: d.dishName, cycles: d.totalCycles, avgMs: d.avgTimeMs });
  }
  allChefDishes.sort((a, b) => b.avgMs - a.avgMs);
  const topChef = allChefDishes.slice(0, 10);
  topChef.forEach((d, i) => {
    ws.addRow([i + 1, d.cat, d.name, d.cycles, formatDuration(d.avgMs)]);
  });
  if (topChef.length === 0) ws.addRow(['', '', 'Нет данных за период']);

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ───────────────────────────────────────────────────────────────────────────
// Лист 2: История стопов (с UI-фильтрами + outline groups)
// ───────────────────────────────────────────────────────────────────────────

function buildHistorySheet(
  wb: ExcelJS.Workbook,
  history: HistoryReport,
  settings: SystemSettings
): void {
  const ws = wb.addWorksheet('История стопов');

  const filterLabels: Record<HistoryReport['targetTypeFilter'], string> = {
    all: 'Всё',
    dish: 'Только блюда',
    ingredient: 'Только ингредиенты',
  };
  const groupLabels: Record<HistoryReport['groupMode'], string> = {
    'by-item': 'По продуктам',
    'by-date': 'По датам',
  };

  // Шапка с применёнными фильтрами
  ws.addRow(['История стоп-листов']).font = { bold: true, size: 14 };
  ws.addRow(['Фильтр по типу:', filterLabels[history.targetTypeFilter]]);
  ws.addRow(['Группировка:', groupLabels[history.groupMode]]);
  if (history.searchQuery.trim()) {
    ws.addRow(['Поиск:', history.searchQuery.trim()]);
  }
  ws.addRow([]);

  const HEADER_ROW = ws.lastRow!.number + 1;

  // Колонки таблицы
  const headers = [
    'Уровень',                   // A: Продукт / Дата / Стоп (для by-item) или Дата / Стоп (для by-date)
    'Тип',                       // B: Блюдо / Ингредиент
    'Название',                  // C
    'Поставлен',                 // D — datetime
    'Снят',                      // E — datetime или пусто (активный)
    'Длительность (сек)',        // F — число
    'Длительность',              // G — текст «5м 20с»
    '% от рабочего времени',     // H — только для верхних уровней групп
    'Кол-во стопов',             // I — для верхних уровней
    'Причина',                   // J
    'Поставил',                  // K
    'Снял',                      // L
    'Источник',                  // M — slicer/kds/cascade
    'Активен',                   // N — ДА/НЕТ
  ];
  ws.addRow(headers);
  ws.columns = [
    { width: 14 }, { width: 14 }, { width: 38 },
    { width: 18 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 12 },
    { width: 30 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 10 },
  ];
  for (let c = 4; c <= 5; c++) {
    ws.getColumn(c).numFmt = 'dd.mm.yyyy hh:mm:ss';
  }

  // % downtime считаем ТОЧНО так же как UI (HistoryGroupRow в StopListHistorySection):
  //  1. effectiveRangeEnd = min(rangeEnd, Date.now()) — обрезаем «активные»
  //     стопы по текущему моменту, чтобы не уходить в будущее.
  //  2. totalPossibleDuration = бизнес-часы за [rangeStart; effectiveRangeEnd].
  //  3. actualStoppedMs = для каждого union-интервала entries (после mergeIntervals)
  //     считаем бизнес-overlap, клипуя по [rangeStart; effectiveRangeEnd].
  //  4. percent = min(100, round(actual / total * 100)).
  // Без этого % мог превышать 100 и расходиться с UI.
  const effectiveRangeEnd = Math.min(history.rangeEnd, Date.now());
  const totalPossibleDuration = Math.max(1, calculateBusinessOverlap(
    history.rangeStart,
    effectiveRangeEnd,
    settings.restaurantOpenTime || '12:00',
    settings.restaurantCloseTime || '23:59',
    settings.excludedDates || []
  ));

  /** Считает % downtime по entries — копия логики HistoryGroupRow в UI. */
  const calcPercent = (entries: DashboardHistoryEntry[]): number => {
    const actualStoppedMs = mergeIntervals(
      entries.map(e => ({
        stoppedAt: e.stoppedAt,
        resumedAt: e.isActive ? effectiveRangeEnd : e.resumedAt,
      }))
    ).reduce((sum, [start, end]) => {
      const clippedStart = Math.max(history.rangeStart, start);
      const clippedEnd = Math.min(effectiveRangeEnd, end);
      if (clippedEnd > clippedStart) {
        return sum + calculateBusinessOverlap(
          clippedStart, clippedEnd,
          settings.restaurantOpenTime || '12:00',
          settings.restaurantCloseTime || '23:59',
          settings.excludedDates || []
        );
      }
      return sum;
    }, 0);
    return Math.min(100, Math.round((actualStoppedMs / totalPossibleDuration) * 100));
  };

  const sourceLabel = (s: string | null | undefined): string => {
    if (s === 'kds') return 'KDS';
    if (s === 'cascade') return 'каскад';
    if (s === 'slicer') return 'нарезчик';
    return s || '';
  };

  // Helper: добавить одну строку «entry» (нижний уровень)
  const addEntryRow = (e: DashboardHistoryEntry, level: 1 | 2) => {
    const isDish = e.ingredientName.startsWith('[DISH]');
    const cleanName = isDish ? e.ingredientName.replace(/^\[DISH\]\s*/, '') : e.ingredientName;
    const durationSec = Math.round(e.durationMs / 1000);
    const row = ws.addRow([
      'Стоп',
      isDish ? 'Блюдо' : 'Ингредиент',
      cleanName,
      new Date(e.stoppedAt),
      e.isActive ? null : new Date(e.resumedAt),
      durationSec,
      formatDuration(e.durationMs),
      null,                     // % downtime — на уровне группы, не entry
      null,                     // Кол-во стопов
      e.reason || '',
      e.stoppedByName || '',
      e.resumedByName || '',
      sourceLabel(e.actorSource),
      e.isActive ? 'ДА' : 'НЕТ',
    ]);
    row.outlineLevel = level;
    if (e.isActive) {
      row.font = { color: { argb: 'FFDC2626' }, bold: true };
    }
  };

  if (history.groupMode === 'by-item') {
    // Группировка: Продукт → Даты → Стопы

    type ItemGroup = {
      name: string;
      entries: DashboardHistoryEntry[];
      isActive: boolean;
      dates: Map<string, DashboardHistoryEntry[]>;
    };
    const groups = new Map<string, ItemGroup>();
    for (const e of history.entries) {
      const key = e.ingredientName;
      let g = groups.get(key);
      if (!g) {
        g = { name: key, entries: [], isActive: false, dates: new Map() };
        groups.set(key, g);
      }
      g.entries.push(e);
      if (e.isActive) g.isActive = true;
      const d = new Date(e.stoppedAt);
      const dStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
      const arr = g.dates.get(dStr) ?? [];
      arr.push(e);
      g.dates.set(dStr, arr);
    }

    // Сортировка (как в UI): активные сверху → ранг по типу/складу
    // (ингредиенты → Кухня → Бар → прочие → без склада) → downtime DESC.
    const sorted = Array.from(groups.values()).sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const rankA = getStorageRank(a.entries[0]);
      const rankB = getStorageRank(b.entries[0]);
      if (rankA !== rankB) return rankA - rankB;
      return sumMergedMs(b.entries) - sumMergedMs(a.entries);
    });

    // Палитра цветов для секций — соответствует UI (зелёный для ингредиентов,
     // оранжевый для кухни, голубой для бара, серый для прочих).
    const sectionColors: Record<string, string> = {
      active: 'FFFCA5A5',     // red-300 — активные стопы
      'rank-0': 'FF6EE7B7',   // emerald-300 — ингредиенты
      'rank-1': 'FFFDBA74',   // orange-300 — Кухня
      'rank-2': 'FF67E8F9',   // cyan-300 — Бар
      'rank-3': 'FFCBD5E1',   // slate-300 — Прочие
      'rank-4': 'FFE2E8F0',   // slate-200 — Без склада
    };

    /** Добавить строку-разделитель секции на отдельной строке. */
    const addSectionRow = (label: string, fgColor: string) => {
      const row = ws.addRow([`── ${label} ──`]);
      ws.mergeCells(row.number, 1, row.number, 14);
      const cell = row.getCell(1);
      cell.font = { bold: true, color: { argb: 'FF1F2937' } }; // slate-800 текст
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fgColor } };
      row.outlineLevel = 0;
    };

    let lastSectionKey: string | null = null;
    for (const g of sorted) {
      // Вставляем заголовок секции при смене ранга (или при первой активной).
      const sectionKey: string = g.isActive ? 'active' : `rank-${getStorageRank(g.entries[0])}`;
      if (sectionKey !== lastSectionKey) {
        const label = sectionKey === 'active' ? 'Активные сейчас' : getStorageRankLabel(getStorageRank(g.entries[0]));
        addSectionRow(label, sectionColors[sectionKey] || sectionColors['rank-3']);
        lastSectionKey = sectionKey;
      }

      const isDish = g.name.startsWith('[DISH]');
      const cleanName = isDish ? g.name.replace(/^\[DISH\]\s*/, '') : g.name;
      const groupDowntimeMs = sumMergedMs(g.entries);
      // % считаем ТОЧНО как UI — через calcPercent (см. helper выше).
      const downtimePercent = calcPercent(g.entries);

      const groupRow = ws.addRow([
        'Продукт',
        isDish ? 'Блюдо' : 'Ингредиент',
        cleanName,
        null, null,
        Math.round(groupDowntimeMs / 1000),
        formatDuration(groupDowntimeMs),
        `${downtimePercent}%`,
        g.entries.length,
        '', '', '', '',
        g.isActive ? 'ДА' : 'НЕТ',
      ]);
      groupRow.outlineLevel = 0;
      styleByOutlineLevel(groupRow, 0);

      // Сортируем даты от свежих к старым (как в UI)
      const dates = Array.from(g.dates.entries()).sort((a, b) => {
        const [d1, m1, y1] = a[0].split('.').map(Number);
        const [d2, m2, y2] = b[0].split('.').map(Number);
        return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
      });

      for (const [dateStr, dayEntries] of dates) {
        const dayMs = sumMergedMs(dayEntries);
        const dateRow = ws.addRow([
          'Дата', '',
          dateStr,
          null, null,
          Math.round(dayMs / 1000),
          formatDuration(dayMs),
          '',
          dayEntries.length,
          '', '', '', '', '',
        ]);
        dateRow.outlineLevel = 1;
        styleByOutlineLevel(dateRow, 1);

        // Стопы внутри дня — свежие сверху
        const sortedEntries = [...dayEntries].sort((a, b) => b.stoppedAt - a.stoppedAt);
        for (const e of sortedEntries) addEntryRow(e, 2);
      }
    }
  } else {
    // by-date: Дата → Стопы

    type DateGroup = { dateStr: string; entries: DashboardHistoryEntry[]; isActive: boolean };
    const groups = new Map<string, DateGroup>();
    for (const e of history.entries) {
      const d = new Date(e.stoppedAt);
      const dStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
      let g = groups.get(dStr);
      if (!g) {
        g = { dateStr: dStr, entries: [], isActive: false };
        groups.set(dStr, g);
      }
      g.entries.push(e);
      if (e.isActive) g.isActive = true;
    }

    const sortedDays = Array.from(groups.values()).sort((a, b) => {
      const [d1, m1, y1] = a.dateStr.split('.').map(Number);
      const [d2, m2, y2] = b.dateStr.split('.').map(Number);
      return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
    });

    for (const g of sortedDays) {
      const dayMs = sumMergedMs(g.entries);
      // % за день: dayMs / один рабочий день
      const dayStartMs = (() => {
        const [d, m, y] = g.dateStr.split('.').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
      })();
      const dayEndMs = dayStartMs + 86400000;
      const dayBusinessMs = calculateBusinessOverlap(
        dayStartMs, dayEndMs,
        settings.restaurantOpenTime || '12:00',
        settings.restaurantCloseTime || '23:59',
        settings.excludedDates || []
      );
      const downtimePercent = dayBusinessMs > 0 ? Math.round((dayMs / dayBusinessMs) * 100) : 0;

      const dateRow = ws.addRow([
        'Дата', '',
        g.dateStr,
        null, null,
        Math.round(dayMs / 1000),
        formatDuration(dayMs),
        `${downtimePercent}%`,
        g.entries.length,
        '', '', '', '',
        g.isActive ? 'ДА' : 'НЕТ',
      ]);
      dateRow.outlineLevel = 0;
      styleByOutlineLevel(dateRow, 0);

      // Внутри дня (как в UI): активные → ранг типа/склада → stoppedAt DESC.
      const sortedEntries = [...g.entries].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        const rankA = getStorageRank(a);
        const rankB = getStorageRank(b);
        if (rankA !== rankB) return rankA - rankB;
        return b.stoppedAt - a.stoppedAt;
      });
      for (const e of sortedEntries) addEntryRow(e, 1);
    }
  }

  applyTableStyling(ws, HEADER_ROW, headers.length);
}

// ───────────────────────────────────────────────────────────────────────────
// Листы 3-4: Скорость отдачи (Обычные / Парковка)
// ───────────────────────────────────────────────────────────────────────────

function buildSpeedSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  data: AggregatedSpeedReport
): void {
  const ws = wb.addWorksheet(sheetName);

  ws.addRow([sheetName]).font = { bold: true, size: 14 };
  ws.addRow([]);

  const headers = [
    'Уровень',                       // A: Категория / Блюдо / Порция
    'Категория',                     // B
    'Блюдо',                         // C
    'Дата завершения',               // D — только для порций
    'Кол-во',                        // E
    'Длительность (сек)',            // F
    'Длительность',                  // G — текст
    'На порцию (сек)',               // H
    'На порцию',                     // I — текст
  ];
  ws.addRow(headers);
  const HEADER_ROW = ws.lastRow!.number;

  ws.columns = [
    { width: 14 }, { width: 22 }, { width: 38 }, { width: 18 },
    { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];
  ws.getColumn(4).numFmt = 'dd.mm.yyyy hh:mm';

  for (const cat of data) {
    const catTotalMs = cat.avgTimeMs * cat.totalCycles; // сумма prep по категории
    const catRow = ws.addRow([
      'Категория', cat.categoryName, '',
      null,
      cat.totalCycles,
      Math.round(catTotalMs / 1000),
      formatDuration(catTotalMs),
      Math.round(cat.avgTimeMs / 1000),
      formatDuration(cat.avgTimeMs),
    ]);
    catRow.outlineLevel = 0;
    styleByOutlineLevel(catRow, 0);

    for (const dish of cat.dishes) {
      const dishTotalMs = dish.avgTimeMs * dish.totalCycles;
      const dishRow = ws.addRow([
        'Блюдо', cat.categoryName, dish.dishName,
        null,
        dish.totalCycles,
        Math.round(dishTotalMs / 1000),
        formatDuration(dishTotalMs),
        Math.round(dish.avgTimeMs / 1000),
        formatDuration(dish.avgTimeMs),
      ]);
      dishRow.outlineLevel = 1;
      styleByOutlineLevel(dishRow, 1);

      // Порции: свежие сверху
      const sortedOrders = [...dish.orders].sort((a, b) => b.completedAt - a.completedAt);
      for (const o of sortedOrders) {
        const perPortionMs = o.totalQuantity > 0 ? o.prepTimeMs / o.totalQuantity : o.prepTimeMs;
        const portionRow = ws.addRow([
          'Порция', cat.categoryName, dish.dishName,
          new Date(o.completedAt),
          o.totalQuantity,
          Math.round(o.prepTimeMs / 1000),
          formatDuration(o.prepTimeMs),
          Math.round(perPortionMs / 1000),
          formatDuration(perPortionMs),
        ]);
        portionRow.outlineLevel = 2;
      }
    }
  }

  applyTableStyling(ws, HEADER_ROW, headers.length);
}

// ───────────────────────────────────────────────────────────────────────────
// Лист 5: Скорость готовки повара
// ───────────────────────────────────────────────────────────────────────────

function buildChefSpeedSheet(wb: ExcelJS.Workbook, data: AggregatedChefReport): void {
  const ws = wb.addWorksheet('Скорость готовки повара');

  ws.addRow(['Скорость готовки повара']).font = { bold: true, size: 14 };
  ws.addRow([]);

  const headers = [
    'Уровень',
    'Категория',
    'Блюдо',
    'Время завершения нарезки',
    'Кол-во',
    'Длительность готовки (сек)',
    'Длительность готовки',
    'На порцию (сек)',
    'На порцию',
  ];
  ws.addRow(headers);
  const HEADER_ROW = ws.lastRow!.number;

  ws.columns = [
    { width: 14 }, { width: 22 }, { width: 38 }, { width: 22 },
    { width: 10 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 14 },
  ];
  ws.getColumn(4).numFmt = 'dd.mm.yyyy hh:mm';

  for (const cat of data) {
    const catTotalMs = cat.avgTimeMs * cat.totalCycles;
    const catRow = ws.addRow([
      'Категория', cat.categoryName, '',
      null,
      cat.totalCycles,
      Math.round(catTotalMs / 1000),
      formatDuration(catTotalMs),
      Math.round(cat.avgTimeMs / 1000),
      formatDuration(cat.avgTimeMs),
    ]);
    catRow.outlineLevel = 0;
    styleByOutlineLevel(catRow, 0);

    for (const dish of cat.dishes) {
      const dishTotalMs = dish.avgTimeMs * dish.totalCycles;
      const dishRow = ws.addRow([
        'Блюдо', cat.categoryName, dish.dishName,
        null,
        dish.totalCycles,
        Math.round(dishTotalMs / 1000),
        formatDuration(dishTotalMs),
        Math.round(dish.avgTimeMs / 1000),
        formatDuration(dish.avgTimeMs),
      ]);
      dishRow.outlineLevel = 1;
      styleByOutlineLevel(dishRow, 1);

      const sortedPortions = [...dish.portions].sort((a, b) => b.finishedAt - a.finishedAt);
      for (const p of sortedPortions) {
        const perPortionMs = p.quantity > 0 ? p.cookTimeMs / p.quantity : p.cookTimeMs;
        const portionRow = ws.addRow([
          'Порция', cat.categoryName, dish.dishName,
          new Date(p.finishedAt),
          p.quantity,
          Math.round(p.cookTimeMs / 1000),
          formatDuration(p.cookTimeMs),
          Math.round(perPortionMs / 1000),
          formatDuration(perPortionMs),
        ]);
        portionRow.outlineLevel = 2;
      }
    }
  }

  applyTableStyling(ws, HEADER_ROW, headers.length);
}

// ───────────────────────────────────────────────────────────────────────────
// Главная функция экспорта
// ───────────────────────────────────────────────────────────────────────────

/**
 * Создаёт workbook со всеми листами и инициирует скачивание .xlsx.
 * Все секции опциональны — если payload не содержит данных секции,
 * соответствующий лист просто не добавляется.
 */
export async function exportDashboardToExcel(payload: ExportPayload): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Slicer KDS';
  wb.created = new Date();

  buildSummarySheet(wb, payload);
  if (payload.history) buildHistorySheet(wb, payload.history, payload.settings);
  if (payload.speedStandard) buildSpeedSheet(wb, 'Скорость отдачи (Обычные)', payload.speedStandard);
  if (payload.speedParked) buildSpeedSheet(wb, 'Скорость отдачи (Парковка)', payload.speedParked);
  if (payload.chefSpeed) buildChefSpeedSheet(wb, payload.chefSpeed);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, buildFilename(payload.filterRange));
}

// mergeIntervals re-exported по требованию TS isolatedModules + чтобы можно
// было использовать в тестах без отдельного импорта из dashboardUtils.
export { mergeIntervals };
