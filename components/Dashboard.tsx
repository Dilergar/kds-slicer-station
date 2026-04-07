/**
 * Dashboard.tsx — Панель отчётности и аналитики (Wrapper)
 *
 * Содержит фильтр по времени и отображает:
 * 1. Speed KPI
 * 2. Ingredient Consumption
 * 3. Stop List History
 */

import React, { useState } from 'react';
import { IngredientBase, Dish, StopHistoryEntry, OrderHistoryEntry, Category, SystemSettings } from '../types';
import { Calendar, Filter, X } from 'lucide-react';

import { SpeedKpiSection } from './dashboard/SpeedKpiSection';
import { IngredientUsageSection } from './dashboard/IngredientUsageSection';
import { StopListHistorySection } from './dashboard/StopListHistorySection';

interface DashboardProps {
  categories: Category[];
  ingredients: IngredientBase[];
  dishes: Dish[];
  stopHistory: StopHistoryEntry[];
  orderHistory: OrderHistoryEntry[];
  settings: SystemSettings;
}

export const Dashboard: React.FC<DashboardProps> = ({ categories, ingredients, dishes, stopHistory, orderHistory, settings }) => {
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
        <h1 className="text-3xl font-bold text-white">Reports Dashboard</h1>

        {/* Date Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center bg-kds-card p-2 rounded-lg border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 px-3 border-r border-gray-700 mr-2">
            <Filter size={18} className="text-blue-500" />
            <span className="text-sm font-bold text-gray-300 uppercase tracking-wider">Period</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 font-bold uppercase ml-1">From</label>
              <input
                type="datetime-local"
                value={tempStart}
                onChange={(e) => setTempStart(e.target.value)}
                className="bg-slate-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-blue-500 outline-none"
              />
            </div>
            <span className="text-gray-500 mt-4">-</span>
            <div className="flex flex-col">
              <label className="text-[10px] text-gray-500 font-bold uppercase ml-1">To</label>
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
              title="Reset Filters"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {!appliedFilter ? (
        <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-gray-800 rounded-lg text-gray-500">
          <Calendar size={64} className="mb-4 opacity-50" />
          <p className="text-lg font-medium">Please select a time period and click <span className="font-bold text-blue-500">OK</span> to view reports.</p>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <SpeedKpiSection 
            orderHistory={orderHistory} 
            appliedFilter={appliedFilter} 
            categories={categories} 
            dishes={dishes} 
          />
          <IngredientUsageSection 
            orderHistory={orderHistory} 
            appliedFilter={appliedFilter} 
            ingredients={ingredients} 
          />
          <StopListHistorySection 
            stopHistory={stopHistory} 
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
