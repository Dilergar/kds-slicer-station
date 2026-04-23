/**
 * Dashboard.tsx — Панель отчётности и аналитики (Wrapper)
 *
 * Содержит фильтр по времени и отображает:
 * 1. Speed KPI (скорость отдачи нарезчика)
 * 2. Chef Cooking Speed (скорость готовки повара — finished_at → docm2tabl1_cooktime)
 * 3. Ingredient Consumption
 * 4. Stop List History
 */

import React, { useState, useEffect } from 'react';
import { IngredientBase, Dish, OrderHistoryEntry, Category, SystemSettings, ChefCookingEntry } from '../types';
import { Calendar, Filter, X } from 'lucide-react';

import { SpeedKpiSection } from './dashboard/SpeedKpiSection';
import { ChefCookingSpeedSection } from './dashboard/ChefCookingSpeedSection';
import { IngredientUsageSection } from './dashboard/IngredientUsageSection';
import { StopListHistorySection } from './dashboard/StopListHistorySection';
import { fetchChefCookingEntries } from '../services/chefCookingApi';
import { fetchStopHistory } from '../services/stoplistApi';
import { StopHistoryEntry } from '../types';

interface DashboardProps {
  categories: Category[];
  ingredients: IngredientBase[];
  dishes: Dish[];
  orderHistory: OrderHistoryEntry[];
  settings: SystemSettings;
  /** Колбэк для сохранения изменений ингредиента (используется для bufferPercent в расходе) */
  onUpdateIngredient: (id: string, updates: Partial<IngredientBase>) => void;
}

// stopHistory: больше не приходит через prop. Dashboard сам грузит история
// по выбранному периоду через GET /api/stoplist/history?from=&to= (Фикс #2).
// Секция StopListHistorySection дальше получает уже отфильтрованный набор.

export const Dashboard: React.FC<DashboardProps> = ({ categories, ingredients, dishes, orderHistory, settings, onUpdateIngredient }) => {
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

  useEffect(() => {
    if (!appliedFilter) {
      setChefCookingEntries([]);
      setPeriodStopHistory([]);
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

    return () => {
      cancelled = true;
    };
  }, [appliedFilter]);

  const handleApply = () => {
    setAppliedFilter({
      start: tempStart,
      end: tempEnd,
      timestamp: Date.now()
    });
  };

  const handleClear = () => {
    setTempStart('');
    setTempEnd('');
    setAppliedFilter(null);
  };

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

      {!appliedFilter ? (
        <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-gray-800 rounded-lg text-gray-500">
          <Calendar size={64} className="mb-4 opacity-50" />
          <p className="text-lg font-medium">Пожалуйста, выберите период и нажмите <span className="font-bold text-blue-500">OK</span> чтобы увидеть отчёты.</p>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <SpeedKpiSection
            orderHistory={orderHistory}
            appliedFilter={appliedFilter}
            categories={categories}
            dishes={dishes}
          />
          <ChefCookingSpeedSection
            entries={chefCookingEntries}
            appliedFilter={appliedFilter}
            categories={categories}
            dishes={dishes}
          />
          <IngredientUsageSection
            orderHistory={orderHistory}
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
          />
        </div>
      )}
    </div>
  );
};
