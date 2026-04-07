import React, { useState, useMemo } from 'react';
import { OrderHistoryEntry, Dish, Category } from '../../types';
import { formatDuration, SortField, SortDirection } from './dashboardUtils';
import { Zap, Car, Search, X, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, ChevronDown } from 'lucide-react';

interface SpeedKpiSectionProps {
  orderHistory: OrderHistoryEntry[];
  appliedFilter: { start: string; end: string; timestamp: number };
  dishes: Dish[];
  categories: Category[];
}

export const SpeedKpiSection: React.FC<SpeedKpiSectionProps> = ({ orderHistory, appliedFilter, dishes, categories }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
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
      }>();

      orders.forEach(order => {
        const dishDef = dishes.find(d => d.id === order.dishId);
        const categoryId = dishDef ? (dishDef.category_ids?.[0] || 'unknown') : 'unknown';

        const current = dishMap.get(order.dishId) || {
          dishName: order.dishName,
          categoryId: categoryId,
          totalCycles: 0,
          totalPrepTimeMs: 0
        };
        dishMap.set(order.dishId, {
          ...current,
          totalCycles: current.totalCycles + order.totalQuantity,
          totalPrepTimeMs: current.totalPrepTimeMs + order.prepTimeMs
        });
      });

      const categoryMap = new Map<string, {
        categoryName: string;
        totalCycles: number;
        totalPrepTimeMs: number;
        dishes: Array<{ id: string, dishName: string, totalCycles: number, avgTimeMs: number }>;
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
        catStats.dishes.push({
          id: dishId,
          dishName: stats.dishName,
          totalCycles: stats.totalCycles,
          avgTimeMs: stats.totalCycles > 0 ? Math.round(stats.totalPrepTimeMs / stats.totalCycles) : 0
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

    return {
      standard: aggregateByCategory(standardOrders),
      parked: aggregateByCategory(parkedOrders)
    };

  }, [orderHistory, appliedFilter, dishes, categories, searchQuery, sortConfig]);

  return (
    <>
      {/* Search Bar */}
      <div className="mb-6 relative">
        <input
          type="text"
          placeholder="Search dishes..."
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
          <h3 className="text-xl font-bold text-green-400 mb-6 flex items-center shrink-0">
            <Zap className="mr-2" size={20} /> Speed KPI (Standard)
          </h3>

          {speedStats.standard.length === 0 ? (
            <div className="text-center py-8 text-slate-500 italic">No standard orders</div>
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
                        Dish Name
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
                        Cycles
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
                        Avg Time
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
                        {isExpanded && category.dishes.map(item => (
                          <tr key={item.id} className="hover:bg-slate-800/30 transition-colors bg-slate-900/30">
                            <td className="p-3 pl-8 text-white relative flex items-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></div>
                              {item.dishName}
                            </td>
                            <td className="p-3 text-center font-mono text-slate-300 opacity-80">{item.totalCycles}</td>
                            <td className="p-3 text-right font-mono text-green-400/80">{formatDuration(item.avgTimeMs)}</td>
                          </tr>
                        ))}
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
          <h3 className="text-xl font-bold text-yellow-400 mb-6 flex items-center shrink-0">
            <Car className="mr-2" size={20} /> Speed KPI (Parked)
          </h3>

          {speedStats.parked.length === 0 ? (
            <div className="text-center py-8 text-slate-500 italic">No parked orders</div>
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
                        Dish Name
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
                        Cycles
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
                        Avg Time
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
                        {isExpanded && category.dishes.map(item => (
                          <tr key={item.id} className="hover:bg-slate-800/30 transition-colors bg-slate-900/30">
                            <td className="p-3 pl-8 text-white relative flex items-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></div>
                              {item.dishName}
                            </td>
                            <td className="p-3 text-center font-mono text-slate-300 opacity-80">{item.totalCycles}</td>
                            <td className="p-3 text-right font-mono text-yellow-400/80">{formatDuration(item.avgTimeMs)}</td>
                          </tr>
                        ))}
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
