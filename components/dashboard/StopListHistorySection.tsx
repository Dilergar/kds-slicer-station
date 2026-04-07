import React, { useState, useMemo } from 'react';
import { StopHistoryEntry, IngredientBase, Dish, SystemSettings } from '../../types';
import { 
  calculateBusinessOverlap, 
  formatDate, 
  formatDuration, 
  DashboardHistoryEntry, 
  DateGroup, 
  HistoryGroup 
} from './dashboardUtils';
import { ChevronRight } from 'lucide-react';

const MicroTimeline: React.FC<{
  entries: DashboardHistoryEntry[];
  rangeStart: number;
  rangeEnd: number;
  settings: SystemSettings;
}> = ({ entries, rangeStart, rangeEnd, settings }) => {
  if (rangeEnd <= rangeStart) return <div className="h-1.5 w-full bg-slate-800 rounded opacity-50"></div>;

  const totalBusinessDuration = calculateBusinessOverlap(
    rangeStart,
    rangeEnd,
    settings.restaurantOpenTime || "12:00",
    settings.restaurantCloseTime || "23:59",
    settings.excludedDates
  );

  if (totalBusinessDuration <= 0) return <div className="h-1.5 w-full bg-slate-800 rounded opacity-30" title="Outside Business Hours"></div>;

  return (
    <div className="relative w-full h-2 bg-slate-800/60 rounded overflow-hidden flex items-center" title="Activity Timeline (Squeezed to Business Hours)">
      <div className="absolute inset-0 w-full h-full bg-slate-800/30"></div>

      {entries.map((entry, idx) => {
        const start = Math.max(rangeStart, entry.stoppedAt);
        const effectiveEnd = entry.isActive ? Math.min(rangeEnd, Date.now()) : entry.resumedAt;
        const end = Math.min(rangeEnd, effectiveEnd);

        if (end <= start) return null;

        const businessOffsetStart = calculateBusinessOverlap(
          rangeStart,
          start,
          settings.restaurantOpenTime || "12:00",
          settings.restaurantCloseTime || "23:59",
          settings.excludedDates
        );

        const businessDuration = calculateBusinessOverlap(
          start,
          end,
          settings.restaurantOpenTime || "12:00",
          settings.restaurantCloseTime || "23:59",
          settings.excludedDates
        );

        if (businessDuration <= 0) return null;

        const leftPercent = (businessOffsetStart / totalBusinessDuration) * 100;
        const widthPercent = (businessDuration / totalBusinessDuration) * 100;

        return (
          <div
            key={idx}
            className="absolute h-full bg-red-400 group-hover:bg-red-500 transition-colors"
            style={{
              left: `${leftPercent}%`,
              width: `${widthPercent}%`,
              minWidth: '2px'
            }}
          />
        );
      })}
    </div>
  );
};

const DateGroupRow: React.FC<{
  dateGroup: DateGroup;
}> = ({ dateGroup }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <React.Fragment>
      <tr
        className={`border-b border-gray-800/50 cursor-pointer transition-colors
                           ${isExpanded ? 'bg-slate-900/60' : 'bg-slate-900/40 hover:bg-slate-900/50'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td className="px-6 py-3 pl-8">
          <div className="flex items-center gap-4 text-base font-mono text-gray-400">
            <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
              <ChevronRight size={20} className="text-slate-500" />
            </div>
            <span className="text-blue-400 font-bold text-lg">{dateGroup.dateStr}</span>
          </div>
        </td>
        <td className="px-6 py-3 text-gray-400 font-mono text-base">
          {dateGroup.stopCount} stops
        </td>
        <td className="px-6 py-3">
        </td>
        <td className="px-6 py-3 text-right font-mono text-blue-400 font-bold text-lg">
          {formatDuration(dateGroup.totalDuration)}
        </td>
      </tr>

      {isExpanded && dateGroup.entries.map((entry, idx) => (
        <tr key={`${dateGroup.dateStr}-${idx}`} className="bg-slate-900/20 border-b border-gray-800/30 text-base hover:bg-slate-800/40">
          <td className="px-6 py-3 pl-16 text-gray-400 font-mono text-sm">
            Stop #{dateGroup.entries.length - idx}  <span className="text-gray-500 text-sm">({entry.reason || 'N/A'})</span>
          </td>
          <td className="px-6 py-3">
          </td>
          <td className="px-6 py-3 font-mono text-base">
            <div className="flex items-center gap-3">
              <span className="text-blue-300">{formatDate(entry.stoppedAt)}</span>
              <span className="text-gray-600">→</span>
              {entry.isActive ? (
                <span className="text-orange-500 font-bold animate-pulse text-sm uppercase tracking-wider">Active</span>
              ) : (
                <span className="text-green-300">{formatDate(entry.resumedAt)}</span>
              )}
            </div>
          </td>
          <td className="px-6 py-3 text-right font-mono text-gray-300 text-base">
            {formatDuration(entry.durationMs)}
          </td>
        </tr>
      ))}
    </React.Fragment>
  );
};

const HistoryGroupRow: React.FC<{
  group: HistoryGroup;
  rangeStart: number;
  rangeEnd: number;
  settings: SystemSettings;
}> = ({ group, rangeStart, rangeEnd, settings }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const effectiveRangeEnd = Math.min(rangeEnd, Date.now());

  const totalPossibleDuration = Math.max(1, calculateBusinessOverlap(
    rangeStart,
    effectiveRangeEnd,
    settings.restaurantOpenTime || "12:00",
    settings.restaurantCloseTime || "23:59",
    settings.excludedDates
  ));

  const actualStoppedMs = group.entries.reduce((sum, entry) => {
    const start = Math.max(rangeStart, entry.stoppedAt);
    const end = Math.min(effectiveRangeEnd, entry.isActive ? effectiveRangeEnd : entry.resumedAt);

    if (end > start) {
      return sum + calculateBusinessOverlap(
        start,
        end,
        settings.restaurantOpenTime || "12:00",
        settings.restaurantCloseTime || "23:59",
        settings.excludedDates
      );
    }
    return sum;
  }, 0);

  const percentStopped = Math.min(100, Math.round((actualStoppedMs / totalPossibleDuration) * 100));

  const sortedDates = (Object.values(group.dates) as DateGroup[]).sort((a, b) => {
    const [d1, m1, y1] = a.dateStr.split('.').map(Number);
    const [d2, m2, y2] = b.dateStr.split('.').map(Number);
    return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
  });

  return (
    <>
      <tr
        className={`cursor-pointer transition-colors border-b border-gray-800 group
                    ${group.isActive ? 'bg-red-900/10 hover:bg-red-900/20' : 'bg-slate-800/10 hover:bg-slate-800/20'}
                    ${isExpanded ? 'bg-slate-800/30' : ''}
                `}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td className="px-6 py-5 font-bold text-white flex items-center gap-3 text-xl">
          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={24} className="text-slate-400" />
          </div>
          {group.name}
          {group.isActive && <span className="inline-block w-3 h-3 bg-red-500 rounded-full animate-pulse ml-3"></span>}
        </td>
        <td className="px-6 py-5 text-gray-400 font-mono text-base">
          {group.stopCount} stops
        </td>
        <td className="px-6 py-5">
          <div className="flex items-center gap-4 w-full">
            <div className="flex flex-col items-end leading-none text-sm text-gray-400 font-mono w-[80px] shrink-0">
              {rangeEnd - rangeStart > 86400000 && (
                <span>{new Date(rangeStart).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
              )}
              <span>{new Date(rangeStart).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div className="flex-1">
              <MicroTimeline
                entries={group.entries}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                settings={settings}
              />
              <div className="text-center text-xs text-red-900/50 leading-none mt-1.5 font-bold">{percentStopped}%</div>
            </div>

            <div className="flex flex-col items-start leading-none text-sm text-gray-400 font-mono w-[80px] shrink-0">
              {rangeEnd - rangeStart > 86400000 && (
                <span>{new Date(rangeEnd).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
              )}
              <span>{new Date(rangeEnd).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </td>
        <td className="px-6 py-5 text-right font-mono text-yellow-500 text-xl font-bold">
          {formatDuration(group.totalDuration)}
        </td>
      </tr>

      {isExpanded && sortedDates.map((dateGroup) => (
        <DateGroupRow
          key={dateGroup.dateStr}
          dateGroup={dateGroup}
        />
      ))}
    </>
  );
};

interface StopListHistorySectionProps {
  stopHistory: StopHistoryEntry[];
  ingredients: IngredientBase[];
  dishes: Dish[];
  appliedFilter: { start: string; end: string; timestamp: number };
  settings: SystemSettings;
}

export const StopListHistorySection: React.FC<StopListHistorySectionProps> = ({ stopHistory, ingredients, dishes, appliedFilter, settings }) => {
  const filteredHistory = useMemo(() => {
    if (!appliedFilter) return [];

    const startTime = appliedFilter.start ? new Date(appliedFilter.start).getTime() : 0;
    const endTime = appliedFilter.end ? new Date(appliedFilter.end).getTime() : Infinity;
    const reportTime = appliedFilter.timestamp;

    const completed: DashboardHistoryEntry[] = stopHistory
      .filter(entry => entry.stoppedAt >= startTime && entry.stoppedAt <= endTime)
      .map(entry => ({ ...entry, isActive: false }));

    const activeIngredients: DashboardHistoryEntry[] = ingredients
      .filter(i => i.is_stopped && i.stop_timestamp)
      .filter(i => i.stop_timestamp! >= startTime && i.stop_timestamp! <= endTime)
      .filter(i => i.stop_timestamp! <= reportTime)
      .map(i => ({
        id: `active_ing_${i.id}`,
        ingredientName: i.name,
        stoppedAt: i.stop_timestamp!,
        resumedAt: reportTime,
        reason: i.stop_reason || 'Unknown',
        durationMs: reportTime - i.stop_timestamp!,
        isActive: true
      }));

    const activeDishes: DashboardHistoryEntry[] = dishes
      .filter(d => d.is_stopped && d.stop_timestamp)
      .filter(d => d.stop_timestamp! >= startTime && d.stop_timestamp! <= endTime)
      .filter(d => d.stop_timestamp! <= reportTime)
      .map(d => ({
        id: `active_dish_${d.id}`,
        ingredientName: `[DISH] ${d.name}`,
        stoppedAt: d.stop_timestamp!,
        resumedAt: reportTime,
        reason: d.stop_reason || 'Manual',
        durationMs: reportTime - d.stop_timestamp!,
        isActive: true
      }));

    return [...completed, ...activeIngredients, ...activeDishes].sort((a, b) => b.stoppedAt - a.stoppedAt);
  }, [stopHistory, ingredients, dishes, appliedFilter]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-red-400">Stop List History</h3>
        <div className="flex gap-4 text-xs font-mono">
          <span className="text-gray-500">Report Generated: <span className="text-white">{formatDate(appliedFilter.timestamp)}</span></span>
          <span className="text-gray-500">Records: <span className="text-white">{filteredHistory.length}</span></span>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-gray-800 bg-kds-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-800 text-gray-400 font-bold uppercase text-base">
              <tr>
                <th className="px-6 py-4 whitespace-nowrap w-[35%]">Product</th>
                <th className="px-6 py-4 whitespace-nowrap w-[10%]">Count</th>
                <th className="px-6 py-4 whitespace-nowrap w-[35%]">Timeline</th>
                <th className="px-6 py-4 whitespace-nowrap w-[20%] text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {(() => {
                const groupedHistory = filteredHistory.reduce<Record<string, HistoryGroup>>((acc, entry) => {
                  const key = entry.ingredientName;
                  if (!acc[key]) {
                    acc[key] = {
                      name: entry.ingredientName,
                      isActive: false,
                      entries: [],
                      totalDuration: 0,
                      stopCount: 0,
                      dates: {}
                    };
                  }
                  acc[key].entries.push(entry);
                  acc[key].totalDuration += entry.durationMs;
                  acc[key].stopCount += 1;
                  if (entry.isActive) acc[key].isActive = true;

                  const dateObj = new Date(entry.stoppedAt);
                  const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

                  if (!acc[key].dates[dateStr]) {
                    acc[key].dates[dateStr] = {
                      dateStr,
                      totalDuration: 0,
                      stopCount: 0,
                      entries: []
                    };
                  }
                  acc[key].dates[dateStr].entries.push(entry);
                  acc[key].dates[dateStr].totalDuration += entry.durationMs;
                  acc[key].dates[dateStr].stopCount += 1;

                  return acc;
                }, {});

                const sortedGroups = (Object.values(groupedHistory) as HistoryGroup[]).sort((a, b) => {
                  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                  return b.totalDuration - a.totalDuration;
                });

                if (sortedGroups.length === 0) {
                  return (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">
                        No records found for the selected period.
                      </td>
                    </tr>
                  );
                }

                const timelineStart = appliedFilter.start ? new Date(appliedFilter.start).getTime() : (filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1].stoppedAt : Date.now() - 86400000);
                const timelineEnd = appliedFilter.end ? new Date(appliedFilter.end).getTime() : Date.now();

                return sortedGroups.map((group) => (
                  <HistoryGroupRow
                    key={group.name}
                    group={group}
                    rangeStart={timelineStart}
                    rangeEnd={timelineEnd}
                    settings={settings}
                  />
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
