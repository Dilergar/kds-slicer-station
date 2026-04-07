import React, { useState } from 'react';
import { SystemSettings } from '../../types';
import { Check, Ban } from 'lucide-react';

interface SystemSettingsTabProps {
  settings: SystemSettings;
  setSettings: (settings: SystemSettings) => void;
}

export const SystemSettingsTab: React.FC<SystemSettingsTabProps> = ({ settings, setSettings }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  return (
    <div className="bg-kds-card rounded-lg p-6 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">System Settings</h2>

      <div className="space-y-8">
        {/* 1. Business Hours */}
        <div className="border-b border-gray-700 pb-8">
          <label className="block text-gray-400 font-bold mb-4">Restaurant Business Hours</label>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Open Time</label>
              <input
                type="time"
                value={settings.restaurantOpenTime || "12:00"}
                onChange={(e) => setSettings({ ...settings, restaurantOpenTime: e.target.value })}
                className="bg-gray-900 border border-gray-700 text-white p-3 rounded w-full focus:border-blue-500 outline-none font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Close Time</label>
              <input
                type="time"
                value={settings.restaurantCloseTime || "00:00"}
                onChange={(e) => setSettings({ ...settings, restaurantCloseTime: e.target.value })}
                className="bg-gray-900 border border-gray-700 text-white p-3 rounded w-full focus:border-blue-500 outline-none font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Downtime KPI will only be calculated during these hours.</p>
        </div>

        {/* 2. Excluded Dates Calendar */}
        <div className="border-b border-gray-700 pb-8">
          <label className="block text-gray-400 font-bold mb-4">Excluded Dates (Holidays / Closed)</label>
          <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            {/* Calendar Header */}
            <div className="flex justify-between items-center mb-4">
              <button
                onClick={() => {
                  const d = new Date(currentDate);
                  d.setMonth(d.getMonth() - 1);
                  setCurrentDate(d);
                }}
                className="p-1 hover:bg-gray-700 rounded text-gray-400"
              >
                &lt; Prev
              </button>
              <span className="text-white font-bold">
                {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => {
                  const d = new Date(currentDate);
                  d.setMonth(d.getMonth() + 1);
                  setCurrentDate(d);
                }}
                className="p-1 hover:bg-gray-700 rounded text-gray-400"
              >
                Next &gt;
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} className="text-xs text-gray-500 font-bold py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth();
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                const startingDay = firstDay.getDay(); // 0 = Sun

                const cells = [];
                for (let i = 0; i < startingDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="h-10"></div>);
                }

                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isExcluded = (settings.excludedDates || []).includes(dateStr);
                  const isToday = new Date().toDateString() === new Date(year, month, d).toDateString();

                  cells.push(
                    <button
                      key={dateStr}
                      onClick={() => {
                        const current = settings.excludedDates || [];
                        const newExcluded = isExcluded
                          ? current.filter(date => date !== dateStr)
                          : [...current, dateStr];
                        setSettings({ ...settings, excludedDates: newExcluded });
                      }}
                      className={`h-10 rounded-lg text-sm font-medium transition-all relative
                        ${isExcluded
                          ? 'bg-red-900/50 text-red-100 border border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-transparent'
                        }
                        ${isToday ? 'ring-1 ring-blue-500' : ''}
                      `}
                    >
                      {d}
                      {isExcluded && (
                        <div className="absolute top-0 right-0 p-0.5">
                          <Ban size={8} className="text-red-400" />
                        </div>
                      )}
                    </button>
                  );
                }
                return cells;
              })()}
            </div>
            <div className="mt-4 flex gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gray-800 rounded border border-gray-700"></div>
                <span className="text-gray-400">Working Day</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-900/50 rounded border border-red-500"></div>
                <span className="text-gray-400">Excluded (Holiday/Closed)</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Other Settings */}
        <div>
          <label className="block text-gray-400 font-bold mb-2">History Retention (Minutes)</label>
          <p className="text-xs text-gray-500 mb-2">How long completed orders remain in the history list (Max 120 min).</p>
          <input
            type="number"
            min={1}
            max={120}
            value={settings.historyRetentionMinutes || 60}
            onChange={(e) => {
              let val = parseInt(e.target.value) || 60;
              if (val > 120) val = 120;
              if (val < 1) val = 1;
              setSettings({ ...settings, historyRetentionMinutes: val });
            }}
            className="bg-gray-900 border border-gray-700 text-white p-3 rounded w-full focus:border-blue-500 outline-none"
          />
        </div>

        <div className="border-t border-gray-700 pt-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <label className="block text-gray-400 text-sm font-bold mb-1">
                Aggregation Window (minutes)
              </label>
              <p className="text-gray-500 text-sm mb-3 max-w-md">
                Orders for the same dish will only stack together if the existing order has been waiting less than this time.
              </p>
            </div>
            {/* On/Off Toggle */}
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableAggregation === false
                  ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                OFF
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableAggregation: true, enableSmartAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableAggregation !== false
                  ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(22,163,74,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ON
              </button>
            </div>
          </div>

          <div className={`flex items-center gap-4 transition-all duration-300 ${settings.enableAggregation === false ? 'opacity-30 grayscale pointer-events-none select-none' : 'opacity-100'}`}>
            <input
              type="number"
              min="1"
              max="60"
              value={settings.aggregationWindowMinutes}
              onChange={(e) => setSettings({ ...settings, aggregationWindowMinutes: parseInt(e.target.value) || 5 })}
              className="w-24 bg-gray-900 border border-gray-700 rounded p-3 text-white text-center font-mono text-xl focus:border-blue-500 outline-none"
            />
            <span className="text-gray-400">minutes</span>
          </div>

          {/* Smart Wave Aggregation Toggle */}
          <div className="flex justify-between items-start mt-6 mb-2 pt-6 border-t border-slate-700/50">
            <div>
              <div className="flex items-center">
                <label className="block text-gray-400 text-sm font-bold mb-1">
                  Smart Wave Aggregation
                </label>
                <span className="ml-2 bg-yellow-500/20 text-yellow-300 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider border border-yellow-500/30">New</span>
              </div>
              <p className="text-gray-500 text-sm mb-3 max-w-md">
                Волновая система: строит оптимальную очередь по категориям (суп→салат→горячее→десерт), объединяя одинаковые блюда из разных столов. Использует ⏱️ COURSE_FIFO окно для FIFO между волнами.
              </p>
            </div>
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableSmartAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableSmartAggregation === false
                  ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                OFF
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableSmartAggregation: true, enableAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableSmartAggregation !== false
                  ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ON
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
          <p className="text-green-400 text-sm flex items-center gap-2">
            <Check size={16} />
            Settings are saved automatically
          </p>
        </div>
      </div>
    </div>
  );
};
