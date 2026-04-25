import React, { useState, useMemo, useEffect } from 'react';
import { OrderHistoryEntry, Dish, Category } from '../../types';
import { formatDuration, SortField, SortDirection } from './dashboardUtils';
import { MiniTimelineChart, MiniTimelineEntry } from './MiniTimelineChart';
import { Zap, Car, Search, X, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, ChevronDown } from 'lucide-react';
import type { AggregatedSpeedReport } from '../../services/excelExport';

interface SpeedKpiSectionProps {
  orderHistory: OrderHistoryEntry[];
  appliedFilter: { start: string; end: string; timestamp: number };
  dishes: Dish[];
  categories: Category[];
  /**
   * Подписка на агрегированные данные для экспорта в Excel. Срабатывает
   * каждый раз, когда меняются speedStats (search/sort/data-change).
   * Parent должен мемоизировать callback (useCallback), чтобы не было
   * лишних ре-рендеров.
   */
  onDataReady?: (data: { standard: AggregatedSpeedReport; parked: AggregatedSpeedReport }) => void;
}

export const SpeedKpiSection: React.FC<SpeedKpiSectionProps> = ({ orderHistory, appliedFilter, dishes, categories, onDataReady }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // Развёрнутые блюда → показываем drilldown по каждой завершённой партии
  // (один OrderHistoryEntry = одна порция/партия с timestamp + длительность).
  // Уникальность по составному ключу `<panel>:<dishId>`, чтобы независимо
  // разворачивать одно блюдо в «Обычных» и «С парковки».
  const [expandedDishes, setExpandedDishes] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'name',
    direction: 'asc'
  });

  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const toggleDish = (key: string) => {
    setExpandedDishes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * Форматирует timestamp в компактный формат «DD.MM HH:mm» — для drilldown
   * по порциям. Если период отчёта < 1 дня, показываем только время; иначе
   * полный формат с датой.
   */
  const formatPortionTime = (ts: number): string => {
    const d = new Date(ts);
    const datePart = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const timePart = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  };

  const speedStats = useMemo(() => {
    if (!appliedFilter || !orderHistory) return { standard: [], parked: [] };

    const startTime = new Date(appliedFilter.start).getTime();
    const endTime = new Date(appliedFilter.end).getTime();

    const filteredOrders = orderHistory.filter(o =>
      o.completedAt >= startTime && o.completedAt <= endTime
    );

    const aggregateByCategory = (orders: typeof orderHistory) => {
      const dishMap = new Map<string, {
        dishName: string;
        categoryId: string;
        totalCycles: number;
        totalPrepTimeMs: number;
        // Сырые порции (одна запись = одна завершённая партия). Нужны для
        // drilldown в UI: пользователь раскрывает блюдо и видит каждую
        // порцию — когда завершена + сколько готовилась.
        orders: OrderHistoryEntry[];
      }>();

      orders.forEach(order => {
        const dishDef = dishes.find(d => d.id === order.dishId);
        const categoryId = dishDef ? (dishDef.category_ids?.[0] || 'unknown') : 'unknown';

        let cur = dishMap.get(order.dishId);
        if (!cur) {
          cur = {
            dishName: order.dishName,
            categoryId,
            totalCycles: 0,
            totalPrepTimeMs: 0,
            orders: [],
          };
          dishMap.set(order.dishId, cur);
        }
        cur.totalCycles += order.totalQuantity;
        cur.totalPrepTimeMs += order.prepTimeMs;
        cur.orders.push(order);
      });

      const categoryMap = new Map<string, {
        categoryName: string;
        totalCycles: number;
        totalPrepTimeMs: number;
        dishes: Array<{
          id: string;
          dishName: string;
          totalCycles: number;
          avgTimeMs: number;
          orders: OrderHistoryEntry[];
        }>;
      }>();

      dishMap.forEach((stats, dishId) => {
        if (searchQuery && !stats.dishName.toLowerCase().includes(searchQuery.toLowerCase())) {
          return;
        }

        const catDef = categories.find(c => c.id === stats.categoryId);
        const catName = catDef ? catDef.name : 'Unknown Category';
        const catId = stats.categoryId;

        if (!categoryMap.has(catId)) {
          categoryMap.set(catId, {
            categoryName: catName,
            totalCycles: 0,
            totalPrepTimeMs: 0,
            dishes: []
          });
        }

        const catStats = categoryMap.get(catId)!;
        catStats.totalCycles += stats.totalCycles;
        catStats.totalPrepTimeMs += stats.totalPrepTimeMs;
        // Порции сортируем по completedAt DESC — свежие сверху, как в любой
        // нормальной ленте событий. Сортировка категорий/блюд остаётся по
        // выбранному пользователем критерию (имя/кол-во/время).
        const sortedOrders = [...stats.orders].sort((a, b) => b.completedAt - a.completedAt);
        catStats.dishes.push({
          id: dishId,
          dishName: stats.dishName,
          totalCycles: stats.totalCycles,
          avgTimeMs: stats.totalCycles > 0 ? Math.round(stats.totalPrepTimeMs / stats.totalCycles) : 0,
          orders: sortedOrders,
        });
      });

      return Array.from(categoryMap.entries())
        .map(([id, data]) => {
          const sortedDishes = data.dishes.sort((a, b) => {
            let comparison = 0;
            if (sortConfig.field === 'name') {
              comparison = a.dishName.localeCompare(b.dishName);
            } else if (sortConfig.field === 'cycles') {
              comparison = a.totalCycles - b.totalCycles;
            } else if (sortConfig.field === 'time') {
              comparison = a.avgTimeMs - b.avgTimeMs;
            }
            return sortConfig.direction === 'asc' ? comparison : -comparison;
          });

          return {
            id,
            categoryName: data.categoryName,
            totalCycles: data.totalCycles,
            avgTimeMs: data.totalCycles > 0 ? Math.round(data.totalPrepTimeMs / data.totalCycles) : 0,
            dishes: sortedDishes
          };
        })
        .filter(cat => cat.dishes.length > 0)
        .sort((a, b) => {
          let comparison = 0;
          if (sortConfig.field === 'name') {
            comparison = a.categoryName.localeCompare(b.categoryName);
          } else if (sortConfig.field === 'cycles') {
            comparison = a.totalCycles - b.totalCycles;
          } else if (sortConfig.field === 'time') {
            comparison = a.avgTimeMs - b.avgTimeMs;
          }
          return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    };

    const standardOrders = filteredOrders.filter(o => !o.was_parked);
    const parkedOrders = filteredOrders.filter(o => o.was_parked);

    // Entries для MiniTimelineChart: один пункт = одно завершение заказа.
    // value = prepTime на порцию (итого / количество) — честное «сколько
    // секунд ушло на одну штуку». Так столбик высокий = медленно, независимо
    // от того, заказ был на 1 или на 10 порций.
    const toEntries = (list: typeof orderHistory): MiniTimelineEntry[] =>
      list.map(o => ({
        timestamp: o.completedAt,
        value: o.totalQuantity > 0 ? o.prepTimeMs / o.totalQuantity : o.prepTimeMs,
      }));

    return {
      standard: aggregateByCategory(standardOrders),
      parked: aggregateByCategory(parkedOrders),
      standardTimeline: toEntries(standardOrders),
      parkedTimeline: toEntries(parkedOrders),
    };

  }, [orderHistory, appliedFilter, dishes, categories, searchQuery, sortConfig]);

  // Подписываем родителя на актуальные агрегаты — для экспорта в Excel.
  // standard / parked имеют тот же shape, что AggregatedSpeedReport
  // (см. services/excelExport.ts) — orders[] на каждом блюде сохранены.
  useEffect(() => {
    onDataReady?.({
      standard: speedStats.standard as AggregatedSpeedReport,
      parked: speedStats.parked as AggregatedSpeedReport,
    });
  }, [speedStats.standard, speedStats.parked, onDataReady]);

  // Границы timeline-чартов — тот же period, что и фильтр Dashboard.
  const rangeStart = new Date(appliedFilter.start).getTime();
  const rangeEnd = new Date(appliedFilter.end).getTime();

  return (
    <>
      {/* Search Bar */}
      <div className="mb-6 relative">
        <input
          type="text"
          placeholder="Поиск блюд..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-10 text-white focus:outline-none focus:border-blue-500 transition-colors"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Speed KPI Tables */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Standard Orders */}
        <div className="bg-kds-card p-6 rounded-lg border border-gray-800 flex flex-col h-[600px]">
          <h3 className="text-xl font-bold text-green-400 mb-3 flex items-center shrink-0">
            <Zap className="mr-2" size={20} /> Скорость отдачи (Обычные)
          </h3>
          <div className="mb-4 shrink-0">
            <MiniTimelineChart
              entries={speedStats.standardTimeline}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              color="green"
              caption="Где просадка (выше столбик = медленнее)"
            />
          </div>

          {speedStats.standard.length === 0 ? (
            <div className="text-center py-8 text-slate-500 italic">Нет обычных заказов</div>
          ) : (
            <div className="overflow-auto flex-1 rounded-lg border border-gray-700 custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-900 border-b border-slate-700 shadow-sm">
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs pl-8 cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Название Блюда
                        {sortConfig.field === 'name' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs text-center cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('cycles')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Кол-во
                        {sortConfig.field === 'cycles' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs text-right cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('time')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Ср. Время
                        {sortConfig.field === 'time' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {speedStats.standard.map(category => {
                    const isExpanded = expandedCategories.has(category.id) || searchQuery.length > 0;
                    return (
                      <React.Fragment key={category.id}>
                        <tr
                          className="bg-slate-800 border-b border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors"
                          onClick={() => toggleCategory(category.id)}
                        >
                          <td className="p-3 font-bold text-blue-300 uppercase tracking-wider text-sm flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {category.categoryName} <span className="text-slate-500 text-xs text-normal">({category.dishes.length})</span>
                          </td>
                          <td className="p-3 text-center font-bold text-white bg-slate-800/50">
                            {category.totalCycles}
                          </td>
                          <td className="p-3 text-right font-bold text-green-400 bg-slate-800/50">
                            {formatDuration(category.avgTimeMs)}
                          </td>
                        </tr>
                        {isExpanded && category.dishes.map(item => {
                          const dishKey = `standard:${item.id}`;
                          const isDishExpanded = expandedDishes.has(dishKey);
                          return (
                            <React.Fragment key={item.id}>
                              <tr
                                className="hover:bg-slate-800/30 transition-colors bg-slate-900/30 cursor-pointer"
                                onClick={() => toggleDish(dishKey)}
                              >
                                <td className="p-3 pl-8 text-white relative flex items-center gap-2">
                                  {isDishExpanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
                                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div>
                                  {item.dishName}
                                </td>
                                <td className="p-3 text-center font-mono text-slate-300 opacity-80">{item.totalCycles}</td>
                                <td className="p-3 text-right font-mono text-green-400/80">{formatDuration(item.avgTimeMs)}</td>
                              </tr>
                              {isDishExpanded && item.orders.map(o => {
                                // Время на порцию = batch / qty. Если qty=1, перпорционное время = batch.
                                const perPortionMs = o.totalQuantity > 0 ? Math.round(o.prepTimeMs / o.totalQuantity) : o.prepTimeMs;
                                return (
                                  <tr key={o.id} className="bg-slate-950/40 hover:bg-slate-900/50 transition-colors text-xs">
                                    <td className="p-2 pl-16 text-slate-400 font-mono flex items-center gap-2">
                                      <span className="text-slate-600">└</span>
                                      {formatPortionTime(o.completedAt)}
                                    </td>
                                    <td className="p-2 text-center font-mono text-slate-400">{o.totalQuantity} шт</td>
                                    <td className="p-2 text-right font-mono text-green-300/70">
                                      {formatDuration(o.prepTimeMs)}
                                      {o.totalQuantity > 1 && (
                                        <span className="text-slate-500 ml-2">({formatDuration(perPortionMs)}/шт)</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Parked Orders */}
        <div className="bg-kds-card p-6 rounded-lg border border-gray-800 flex flex-col h-[600px]">
          <h3 className="text-xl font-bold text-yellow-400 mb-3 flex items-center shrink-0">
            <Car className="mr-2" size={20} /> Скорость отдачи (С парковки)
          </h3>
          <div className="mb-4 shrink-0">
            <MiniTimelineChart
              entries={speedStats.parkedTimeline}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              color="yellow"
              caption="Где просадка"
            />
          </div>

          {speedStats.parked.length === 0 ? (
            <div className="text-center py-8 text-slate-500 italic">Нет заказов с парковки</div>
          ) : (
            <div className="overflow-auto flex-1 rounded-lg border border-gray-700 custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-900 border-b border-slate-700 shadow-sm">
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs pl-8 cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Название Блюда
                        {sortConfig.field === 'name' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs text-center cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('cycles')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Кол-во
                        {sortConfig.field === 'cycles' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                    <th
                      className="p-3 text-slate-400 font-bold uppercase text-xs text-right cursor-pointer hover:text-white transition-colors select-none"
                      onClick={() => handleSort('time')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Ср. Время
                        {sortConfig.field === 'time' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {speedStats.parked.map(category => {
                    const isExpanded = expandedCategories.has(category.id) || searchQuery.length > 0;
                    return (
                      <React.Fragment key={category.id}>
                        <tr
                          className="bg-slate-800 border-b border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors"
                          onClick={() => toggleCategory(category.id)}
                        >
                          <td className="p-3 font-bold text-blue-300 uppercase tracking-wider text-sm flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {category.categoryName} <span className="text-slate-500 text-xs text-normal">({category.dishes.length})</span>
                          </td>
                          <td className="p-3 text-center font-bold text-white bg-slate-800/50">
                            {category.totalCycles}
                          </td>
                          <td className="p-3 text-right font-bold text-yellow-400 bg-slate-800/50">
                            {formatDuration(category.avgTimeMs)}
                          </td>
                        </tr>
                        {isExpanded && category.dishes.map(item => {
                          const dishKey = `parked:${item.id}`;
                          const isDishExpanded = expandedDishes.has(dishKey);
                          return (
                            <React.Fragment key={item.id}>
                              <tr
                                className="hover:bg-slate-800/30 transition-colors bg-slate-900/30 cursor-pointer"
                                onClick={() => toggleDish(dishKey)}
                              >
                                <td className="p-3 pl-8 text-white relative flex items-center gap-2">
                                  {isDishExpanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
                                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600"></div>
                                  {item.dishName}
                                </td>
                                <td className="p-3 text-center font-mono text-slate-300 opacity-80">{item.totalCycles}</td>
                                <td className="p-3 text-right font-mono text-yellow-400/80">{formatDuration(item.avgTimeMs)}</td>
                              </tr>
                              {isDishExpanded && item.orders.map(o => {
                                const perPortionMs = o.totalQuantity > 0 ? Math.round(o.prepTimeMs / o.totalQuantity) : o.prepTimeMs;
                                return (
                                  <tr key={o.id} className="bg-slate-950/40 hover:bg-slate-900/50 transition-colors text-xs">
                                    <td className="p-2 pl-16 text-slate-400 font-mono flex items-center gap-2">
                                      <span className="text-slate-600">└</span>
                                      {formatPortionTime(o.completedAt)}
                                    </td>
                                    <td className="p-2 text-center font-mono text-slate-400">{o.totalQuantity} шт</td>
                                    <td className="p-2 text-right font-mono text-yellow-300/70">
                                      {formatDuration(o.prepTimeMs)}
                                      {o.totalQuantity > 1 && (
                                        <span className="text-slate-500 ml-2">({formatDuration(perPortionMs)}/шт)</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
