/**
 * ChefCookingSpeedSection — «Скорость готовки повара» в Dashboard.
 *
 * 1 в 1 как SpeedKpiSection, но данные другие: время между нажатием нарезчиком
 * «Готово» и отметкой готовности на раздаче (docm2tabl1_cooktime - finished_at).
 * Отражает чистое время работы повара. Парковочная вкладка здесь не нужна —
 * парковка относится к очереди нарезчика, а не к готовке повара, поэтому
 * показываем один список на всю ширину с фиолетовым акцентом.
 *
 * Агрегация по dishId выполняется на клиенте (как в SpeedKpiSection),
 * чтобы поиск и сортировка работали без запросов на сервер.
 */

import React, { useState, useMemo } from 'react';
import { ChefCookingEntry, Dish, Category } from '../../types';
import { formatDuration, SortField, SortDirection } from './dashboardUtils';
import { MiniTimelineChart, MiniTimelineEntry } from './MiniTimelineChart';
import { ChefHat, Search, X, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, ChevronDown } from 'lucide-react';

interface ChefCookingSpeedSectionProps {
  /**
   * Сырые записи метрики, уже загруженные Dashboard'ом под текущий
   * appliedFilter. Могут прийти пустыми если основная KDS не пишет
   * docm2tabl1_cooktime или нарезчик пока ничего не завершал.
   */
  entries: ChefCookingEntry[];
  appliedFilter: { start: string; end: string; timestamp: number };
  dishes: Dish[];
  categories: Category[];
}

export const ChefCookingSpeedSection: React.FC<ChefCookingSpeedSectionProps> = ({
  entries,
  appliedFilter,
  dishes,
  categories,
}) => {
  // Локальный поиск по имени блюда — не дергает сервер
  const [searchQuery, setSearchQuery] = useState('');
  // Какие категории развернуты — чтобы не всё сразу было открыто
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // Сортировка: по имени / кол-ву / среднему времени
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'name',
    direction: 'asc',
  });

  /** Обработчик клика по заголовку колонки — переключает asc/desc */
  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  /** Развернуть/свернуть категорию */
  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  /**
   * Агрегация сырых записей в иерархию категория → блюдо → ср.время.
   * Логика повторяет SpeedKpiSection (группировка по первой категории блюда
   * из slicer_dish_categories, fallback 'unknown'). totalCycles = сумма quantity
   * (повар готовил N порций), avgTime = суммарное cookTime / totalCycles.
   */
  /**
   * Entries для MiniTimelineChart: один пункт = один замер времени готовки
   * на одну порцию. Если в позиции было N порций (quantity), раскладываем
   * cookTimeMs на порцию — чтобы время в чарте не зависело от размера заказа.
   */
  const timelineEntries = useMemo<MiniTimelineEntry[]>(() => {
    if (!appliedFilter || !entries) return [];
    return entries.map(e => ({
      timestamp: e.finishedAt,
      value: e.quantity > 0 ? e.cookTimeMs / e.quantity : e.cookTimeMs,
    }));
  }, [entries, appliedFilter]);

  const cookingStats = useMemo(() => {
    if (!appliedFilter || !entries) return [];

    const startTime = new Date(appliedFilter.start).getTime();
    const endTime = new Date(appliedFilter.end).getTime();

    // Серверный фильтр уже применил from/to, но на случай если фронт сдвинул
    // appliedFilter без нового запроса — дополнительно фильтруем на клиенте.
    const filteredEntries = entries.filter(e =>
      e.finishedAt >= startTime && e.finishedAt <= endTime
    );

    // Шаг 1: агрегация по блюду
    const dishMap = new Map<string, {
      dishName: string;
      categoryId: string;
      totalCycles: number;
      totalCookTimeMs: number;
    }>();

    filteredEntries.forEach(entry => {
      const dishDef = dishes.find(d => d.id === entry.dishId);
      const categoryId = dishDef ? (dishDef.category_ids?.[0] || 'unknown') : 'unknown';

      const current = dishMap.get(entry.dishId) || {
        dishName: entry.dishName,
        categoryId: categoryId,
        totalCycles: 0,
        totalCookTimeMs: 0,
      };
      dishMap.set(entry.dishId, {
        ...current,
        totalCycles: current.totalCycles + entry.quantity,
        totalCookTimeMs: current.totalCookTimeMs + entry.cookTimeMs,
      });
    });

    // Шаг 2: группировка по категории + локальный поиск
    const categoryMap = new Map<string, {
      categoryName: string;
      totalCycles: number;
      totalCookTimeMs: number;
      dishes: Array<{ id: string; dishName: string; totalCycles: number; avgTimeMs: number }>;
    }>();

    dishMap.forEach((stats, dishId) => {
      if (searchQuery && !stats.dishName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return;
      }

      const catDef = categories.find(c => c.id === stats.categoryId);
      const catName = catDef ? catDef.name : 'Без категории';
      const catId = stats.categoryId;

      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, {
          categoryName: catName,
          totalCycles: 0,
          totalCookTimeMs: 0,
          dishes: [],
        });
      }

      const catStats = categoryMap.get(catId)!;
      catStats.totalCycles += stats.totalCycles;
      catStats.totalCookTimeMs += stats.totalCookTimeMs;
      catStats.dishes.push({
        id: dishId,
        dishName: stats.dishName,
        totalCycles: stats.totalCycles,
        avgTimeMs: stats.totalCycles > 0 ? Math.round(stats.totalCookTimeMs / stats.totalCycles) : 0,
      });
    });

    // Шаг 3: сортировка блюд внутри категории и категорий между собой
    return Array.from(categoryMap.entries())
      .map(([id, data]) => {
        const sortedDishes = data.dishes.sort((a, b) => {
          let comparison = 0;
          if (sortConfig.field === 'name') comparison = a.dishName.localeCompare(b.dishName);
          else if (sortConfig.field === 'cycles') comparison = a.totalCycles - b.totalCycles;
          else if (sortConfig.field === 'time') comparison = a.avgTimeMs - b.avgTimeMs;
          return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

        return {
          id,
          categoryName: data.categoryName,
          totalCycles: data.totalCycles,
          avgTimeMs: data.totalCycles > 0 ? Math.round(data.totalCookTimeMs / data.totalCycles) : 0,
          dishes: sortedDishes,
        };
      })
      .filter(cat => cat.dishes.length > 0)
      .sort((a, b) => {
        let comparison = 0;
        if (sortConfig.field === 'name') comparison = a.categoryName.localeCompare(b.categoryName);
        else if (sortConfig.field === 'cycles') comparison = a.totalCycles - b.totalCycles;
        else if (sortConfig.field === 'time') comparison = a.avgTimeMs - b.avgTimeMs;
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
  }, [entries, appliedFilter, dishes, categories, searchQuery, sortConfig]);

  return (
    <>
      {/* Поиск — внутри секции, чтобы не мешать поиску SpeedKpiSection */}
      <div className="mb-6 relative">
        <input
          type="text"
          placeholder="Поиск блюд в «Скорости готовки повара»..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-10 text-white focus:outline-none focus:border-purple-500 transition-colors"
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

      {/* Таблица на всю ширину — парковка здесь нерелевантна */}
      <div className="mb-8">
        <div className="bg-kds-card p-6 rounded-lg border border-gray-800 flex flex-col h-[600px]">
          <h3 className="text-xl font-bold text-purple-400 mb-3 flex items-center shrink-0">
            <ChefHat className="mr-2" size={20} /> Скорость готовки повара
          </h3>
          <div className="mb-4 shrink-0">
            <MiniTimelineChart
              entries={timelineEntries}
              rangeStart={new Date(appliedFilter.start).getTime()}
              rangeEnd={new Date(appliedFilter.end).getTime()}
              color="purple"
              caption="Где просадка (выше столбик = дольше готовит повар)"
            />
          </div>

          {cookingStats.length === 0 ? (
            <div className="text-center py-8 text-slate-500 italic">
              Нет данных за выбранный период. Метрика показывает разницу между
              нажатием «Готово» нарезчиком и отметкой готовности на раздаче —
              убедитесь что основная KDS заполняет <code className="text-purple-300">docm2tabl1_cooktime</code>.
            </div>
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
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-purple-500" /> : <ArrowDown size={14} className="text-purple-500" />
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
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-purple-500" /> : <ArrowDown size={14} className="text-purple-500" />
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
                          sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-purple-500" /> : <ArrowDown size={14} className="text-purple-500" />
                        ) : <ArrowUpDown size={14} className="opacity-20" />}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {cookingStats.map(category => {
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
                          <td className="p-3 text-right font-bold text-purple-400 bg-slate-800/50">
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
                            <td className="p-3 text-right font-mono text-purple-400/80">{formatDuration(item.avgTimeMs)}</td>
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
