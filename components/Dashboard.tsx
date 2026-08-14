/**
 * Dashboard.tsx — Панель отчётности и аналитики (Wrapper)
 *
 * Содержит фильтр по времени и отображает:
 * 1. Speed KPI (скорость отдачи нарезчика)
 * 2. Chef Cooking Speed (скорость готовки повара — finished_at → docm2tabl1_cooktime)
 * 3. Ingredient Consumption
 * 4. Stop List History
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IngredientBase, Dish, OrderHistoryEntry, Category, SystemSettings, ChefCookingEntry } from '../types';
import { Calendar, Filter, X, FileDown } from 'lucide-react';

import { SpeedKpiSection } from './dashboard/SpeedKpiSection';
import { ChefCookingSpeedSection } from './dashboard/ChefCookingSpeedSection';
import { IngredientUsageSection } from './dashboard/IngredientUsageSection';
import { StopListHistorySection } from './dashboard/StopListHistorySection';
import { fetchChefCookingEntries } from '../services/chefCookingApi';
import { fetchStopHistory } from '../services/stoplistApi';
import { fetchOrderHistory } from '../services/ordersApi';
import { StopHistoryEntry } from '../types';
import {
  exportDashboardToExcel,
  ExportPayload,
  AggregatedSpeedReport,
  AggregatedChefReport,
  HistoryReport,
} from '../services/excelExport';

interface DashboardProps {
  categories: Category[];
  ingredients: IngredientBase[];
  dishes: Dish[];
  settings: SystemSettings;
  /** Колбэк для сохранения изменений ингредиента (используется для bufferPercent в расходе) */
  onUpdateIngredient: (id: string, updates: Partial<IngredientBase>) => void;
}

// stopHistory: больше не приходит через prop. Dashboard сам грузит история
// по выбранному периоду через GET /api/stoplist/history?from=&to= (Фикс #2).
// Секция StopListHistorySection дальше получает уже отфильтрованный набор.
//
// orderHistory — с 2026-08-14 тоже. Раньше отчёты брали общий массив из useOrders,
// а тот теперь грузит только окно «Хранение истории» (иначе доска каждые 4 секунды
// качала всю накопленную историю). Отчётам нужен произвольный период, поэтому они
// запрашивают его сами — тем же запросом, но с from/to.

export const Dashboard: React.FC<DashboardProps> = ({ categories, ingredients, dishes, settings, onUpdateIngredient }) => {
  const [tempStart, setTempStart] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00`;
  });

  const [tempEnd, setTempEnd] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T23:59`;
  });

  const [appliedFilter, setAppliedFilter] = useState<{ start: string; end: string; timestamp: number } | null>(null);

  /** Текст ошибки выбора периода (пустые поля, перевёрнутый диапазон); '' = всё в порядке */
  const [filterError, setFilterError] = useState('');

  // Метрика «Скорость готовки повара» живёт в отдельном endpoint,
  // а не в orderHistory — её сырые записи грузим при применении фильтра.
  // При clear — сбрасываем в пустой массив, чтобы не показывать устаревшие данные.
  const [chefCookingEntries, setChefCookingEntries] = useState<ChefCookingEntry[]>([]);

  // История стопов за выбранный период. Серверный фильтр по
  // пересечению интервалов (resumed_at >= from AND stopped_at <= to),
  // поэтому попадают стопы, начавшиеся до периода и закончившиеся в нём,
  // и стопы целиком внутри периода, и активные (resumed_at = NULL).
  // Годовой отчёт — один запрос, все записи в диапазоне без лимита.
  const [periodStopHistory, setPeriodStopHistory] = useState<StopHistoryEntry[]>([]);

  // История завершённых заказов за выбранный период — источник для секций
  // «Скорость нарезчика» и «Расход ингредиентов».
  const [periodOrderHistory, setPeriodOrderHistory] = useState<OrderHistoryEntry[]>([]);

  useEffect(() => {
    if (!appliedFilter) {
      setChefCookingEntries([]);
      setPeriodStopHistory([]);
      setPeriodOrderHistory([]);
      return;
    }

    // Конвертируем datetime-local (без таймзоны) в ISO, чтобы сервер понял.
    // Фронт и сервер сейчас в одной таймзоне локально, но если будет разнос —
    // лучше передавать ISO, а не сырой datetime-local.
    const fromIso = new Date(appliedFilter.start).toISOString();
    const toIso = new Date(appliedFilter.end).toISOString();

    let cancelled = false;
    fetchChefCookingEntries(fromIso, toIso)
      .then(data => {
        if (!cancelled) setChefCookingEntries(data);
      })
      .catch(err => {
        console.error('[Dashboard] Ошибка загрузки chef-cooking-speed:', err);
        if (!cancelled) setChefCookingEntries([]);
      });

    fetchStopHistory(fromIso, toIso)
      .then(data => {
        if (!cancelled) setPeriodStopHistory(data);
      })
      .catch(err => {
        console.error('[Dashboard] Ошибка загрузки stop-history:', err);
        if (!cancelled) setPeriodStopHistory([]);
      });

    fetchOrderHistory({ from: fromIso, to: toIso })
      .then(data => {
        if (!cancelled) setPeriodOrderHistory(data);
      })
      .catch(err => {
        console.error('[Dashboard] Ошибка загрузки истории заказов:', err);
        if (!cancelled) setPeriodOrderHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedFilter]);

  /**
   * Применяет выбранный период после проверки. Проверка обязательна: раньше
   * «Сбросить фильтры» обнуляло поля, но OK всё равно создавал объект фильтра,
   * охранное условие `if (!appliedFilter)` его пропускало, и пустая строка
   * доходила до new Date('').toISOString() — RangeError прямо в эффекте
   * укладывал всё приложение в белый экран.
   */
  const handleApply = () => {
    const startMs = Date.parse(tempStart);
    const endMs = Date.parse(tempEnd);

    if (!tempStart || !tempEnd || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setFilterError('Укажите обе даты периода');
      return;
    }
    if (startMs > endMs) {
      setFilterError('Начало периода позже конца — поменяйте даты местами');
      return;
    }

    setFilterError('');
    setAppliedFilter({
      start: tempStart,
      end: tempEnd,
      timestamp: Date.now()
    });
  };

  const handleClear = () => {
    setFilterError('');
    setTempStart('');
    setTempEnd('');
    setAppliedFilter(null);
  };

  // ──────────────────────────────────────────────────────────────────────
  // Excel-экспорт: каждая секция отдаёт свои агрегаты в latestReportRef.
  // На клик «Экспорт в Excel» собираем payload и сохраняем .xlsx через
  // services/excelExport.ts. Используем ref (а не state), чтобы обновления
  // от секций не вызывали ре-рендер Dashboard.
  // ──────────────────────────────────────────────────────────────────────
  const latestReportRef = useRef<{
    speedStandard?: AggregatedSpeedReport;
    speedParked?: AggregatedSpeedReport;
    chefSpeed?: AggregatedChefReport;
    history?: HistoryReport;
    // Строки поиска секций — экспорт печатает их в шапке листов, чтобы
    // отфильтрованную книгу нельзя было принять за полный отчёт
    speedSearchQuery?: string;
    chefSearchQuery?: string;
  }>({});
  const [isExporting, setIsExporting] = useState(false);

  const handleSpeedDataReady = useCallback((data: { standard: AggregatedSpeedReport; parked: AggregatedSpeedReport; searchQuery: string }) => {
    latestReportRef.current.speedStandard = data.standard;
    latestReportRef.current.speedParked = data.parked;
    latestReportRef.current.speedSearchQuery = data.searchQuery;
  }, []);
  const handleChefDataReady = useCallback((data: { report: AggregatedChefReport; searchQuery: string }) => {
    latestReportRef.current.chefSpeed = data.report;
    latestReportRef.current.chefSearchQuery = data.searchQuery;
  }, []);
  const handleHistoryDataReady = useCallback((data: HistoryReport) => {
    latestReportRef.current.history = data;
  }, []);

  const handleExport = useCallback(async () => {
    if (!appliedFilter) return;
    setIsExporting(true);
    try {
      const payload: ExportPayload = {
        filterRange: { start: appliedFilter.start, end: appliedFilter.end },
        settings,
        speedStandard: latestReportRef.current.speedStandard,
        speedParked: latestReportRef.current.speedParked,
        chefSpeed: latestReportRef.current.chefSpeed,
        history: latestReportRef.current.history,
        speedSearchQuery: latestReportRef.current.speedSearchQuery,
        chefSearchQuery: latestReportRef.current.chefSearchQuery,
      };
      await exportDashboardToExcel(payload);
    } catch (err) {
      console.error('[Dashboard] Ошибка экспорта в Excel:', err);
      alert('Не удалось создать Excel-файл. Подробности в консоли.');
    } finally {
      setIsExporting(false);
    }
  }, [appliedFilter, settings]);

  return (
    <div className="flex-1 bg-kds-bg p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <h1 className="text-3xl font-bold text-white">Сводка Отчётов</h1>

        {/* Date Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center bg-kds-card p-2 rounded-lg border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 px-3 border-r border-gray-700 mr-2">
            <Filter size={18} className="text-blue-500" />
            <span className="text-sm font-bold text-gray-300 uppercase tracking-wider">Период</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 font-bold uppercase ml-1">С (От)</label>
              <input
                type="datetime-local"
                value={tempStart}
                onChange={(e) => setTempStart(e.target.value)}
                className="bg-slate-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-blue-500 outline-none"
              />
            </div>
            <span className="text-gray-500 mt-4">-</span>
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 font-bold uppercase ml-1">По (До)</label>
              <input
                type="datetime-local"
                value={tempEnd}
                onChange={(e) => setTempEnd(e.target.value)}
                className="bg-slate-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleApply}
            className="ml-3 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider rounded shadow-lg shadow-blue-900/20 transition-all flex items-center gap-2"
          >
            OK
          </button>

          {/* Экспорт в Excel — активен только когда фильтр применён, потому что
              без него секции не сгенерировали данные для выгрузки. */}
          <button
            onClick={handleExport}
            disabled={!appliedFilter || isExporting}
            className="ml-2 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold uppercase tracking-wider rounded shadow-lg shadow-green-900/20 transition-all flex items-center gap-2"
            title={!appliedFilter ? 'Сначала примените период (OK)' : 'Скачать .xlsx со всеми отчётами'}
          >
            <FileDown size={16} />
            {isExporting ? 'Сохраняю…' : 'Excel'}
          </button>

          {(tempStart || tempEnd || appliedFilter) && (
            <button
              onClick={handleClear}
              className="ml-2 p-2 hover:bg-red-900/30 text-red-400 rounded transition-colors"
              title="Сбросить фильтры"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Ошибка выбора периода — рядом с фильтром, чтобы было видно куда смотреть */}
      {filterError && (
        <div className="mb-4 px-4 py-2 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-sm font-medium">
          {filterError}
        </div>
      )}

      {!appliedFilter ? (
        <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-gray-800 rounded-lg text-gray-500">
          <Calendar size={64} className="mb-4 opacity-50" />
          <p className="text-lg font-medium">Пожалуйста, выберите период и нажмите <span className="font-bold text-blue-500">OK</span> чтобы увидеть отчёты.</p>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <SpeedKpiSection
            orderHistory={periodOrderHistory}
            appliedFilter={appliedFilter}
            categories={categories}
            dishes={dishes}
            onDataReady={handleSpeedDataReady}
          />
          <ChefCookingSpeedSection
            entries={chefCookingEntries}
            appliedFilter={appliedFilter}
            categories={categories}
            dishes={dishes}
            onDataReady={handleChefDataReady}
          />
          <IngredientUsageSection
            orderHistory={periodOrderHistory}
            appliedFilter={appliedFilter}
            ingredients={ingredients}
            onUpdateIngredient={onUpdateIngredient}
          />
          <StopListHistorySection
            stopHistory={periodStopHistory}
            ingredients={ingredients}
            dishes={dishes}
            appliedFilter={appliedFilter}
            settings={settings}
            onDataReady={handleHistoryDataReady}
          />
        </div>
      )}
    </div>
  );
};
