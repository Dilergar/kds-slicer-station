import React, { useState, useMemo, useEffect } from 'react';
import { OrderHistoryEntry, IngredientBase } from '../../types';
import { formatWeight } from './dashboardUtils';
import { Package, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X } from 'lucide-react';

interface IngredientUsageSectionProps {
  orderHistory: OrderHistoryEntry[];
  appliedFilter: { start: string; end: string; timestamp: number };
  ingredients: IngredientBase[];
  /**
   * Сохранение bufferPercent. Вызывается при blur поля «+%» (а не onChange),
   * чтобы не слать PUT на каждое нажатие клавиши. Ставит
   * `slicer_ingredients.buffer_percent` через PUT /api/ingredients/:id.
   */
  onUpdateIngredient: (id: string, updates: Partial<IngredientBase>) => void;
}

export const IngredientUsageSection: React.FC<IngredientUsageSectionProps> = ({ orderHistory, appliedFilter, ingredients, onUpdateIngredient }) => {
  const [ingredientSort, setIngredientSort] = useState<{ field: 'name' | 'weight'; direction: 'asc' | 'desc' }>({
    field: 'weight',
    direction: 'desc'
  });
  const [expandedUsageGroups, setExpandedUsageGroups] = useState<Set<string>>(new Set());

  // Поиск по названию родителя или его разновидности. Работает уже по
  // посчитанным consumptionData, чтобы не дублировать агрегацию.
  const [searchQuery, setSearchQuery] = useState('');

  // Локальный кеш значений в полях (строка — пока пользователь печатает).
  // При blur отправляем в БД. При перезагрузке ingredients (reloadIngredients)
  // — перезаполняем из source of truth. Так UI всегда отображает что реально
  // в БД, и сразу реагирует на ввод без лага на round-trip.
  const [bufferPercentages, setBufferPercentages] = useState<Record<string, string>>({});

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const ing of ingredients) {
      const v = ing.bufferPercent ?? 0;
      if (v !== 0) initial[ing.id] = String(v);
    }
    setBufferPercentages(initial);
  }, [ingredients]);

  const handleIngredientSort = (field: 'name' | 'weight') => {
    setIngredientSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleUsageGroup = (id: string) => {
    setExpandedUsageGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBufferChange = (id: string, value: string) => {
    if (value === '' || /^\d*$/.test(value)) {
      setBufferPercentages(prev => ({ ...prev, [id]: value }));
    }
  };

  /**
   * Сохраняем в БД на blur — но только если значение реально поменялось.
   * Иначе каждый фокус-уход дёргал бы API без пользы.
   * Пустая строка трактуется как 0 (возврат к дефолту).
   */
  const handleBufferBlur = (id: string) => {
    const raw = bufferPercentages[id] ?? '';
    const nextValue = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(nextValue)) return;

    const ing = ingredients.find(i => i.id === id);
    const currentValue = ing?.bufferPercent ?? 0;
    if (nextValue === currentValue) return;

    onUpdateIngredient(id, { bufferPercent: nextValue });
  };

  const calculateItemGross = (netGrams: number, id: string): number => {
    const percent = parseFloat(bufferPercentages[id] || '0');
    return Math.round(netGrams * (1 + percent / 100));
  };

  const consumptionData = useMemo(() => {
    if (!appliedFilter || !orderHistory) return [];

    const startTime = new Date(appliedFilter.start).getTime();
    const endTime = new Date(appliedFilter.end).getTime();

    const filteredOrders = orderHistory.filter(o =>
      o.completedAt >= startTime && o.completedAt <= endTime
    );

    const usageMap = new Map<string, {
      name: string;
      imageUrl?: string;
      unitType: 'kg' | 'piece';
      totalQuantity: number;
      totalWeightGrams: number;
    }>();

    filteredOrders.forEach(order => {
      order.consumedIngredients.forEach(ing => {
        const current = usageMap.get(ing.id) || {
          name: ing.name,
          imageUrl: ing.imageUrl,
          unitType: ing.unitType,
          totalQuantity: 0,
          totalWeightGrams: 0
        };
        usageMap.set(ing.id, {
          ...current,
          totalQuantity: current.totalQuantity + ing.quantity,
          totalWeightGrams: current.totalWeightGrams + ing.weightGrams
        });
      });
    });

    const groups = new Map<string, {
      groupId: string;
      parentName: string;
      parentImage?: string;
      parent?: IngredientBase;
      items: Array<{ id: string; name: string; imageUrl?: string; unitType: 'kg' | 'piece'; totalQuantity: number; totalWeightGrams: number; }>;
      totalWeight: number;
    }>();

    usageMap.forEach((data, id) => {
      let parent = ingredients.find(i => i.id === id);
      if (parent?.parentId) {
        parent = ingredients.find(p => p.id === parent.parentId);
      }
      if (!parent) {
        parent = ingredients.find(i => i.id === id);
      }

      const parentId = parent?.id || 'unknown';
      const parentName = parent?.name || 'Uncategorized';

      if (!groups.has(parentId)) {
        groups.set(parentId, {
          groupId: parentId,
          parentName,
          parentImage: parent?.imageUrl,
          parent,
          items: [],
          totalWeight: 0
        });
      }

      const group = groups.get(parentId)!;
      group.items.push({ id, ...data });
      group.totalWeight += data.totalWeightGrams;
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      let comparison = 0;
      if (ingredientSort.field === 'name') {
        comparison = a.parentName.localeCompare(b.parentName);
      } else {
        comparison = a.totalWeight - b.totalWeight;
      }
      return ingredientSort.direction === 'asc' ? comparison : -comparison;
    });

    sortedGroups.forEach(group => {
      group.items.sort((x, y) => x.name.localeCompare(y.name));
    });

    return sortedGroups;

  }, [orderHistory, appliedFilter, ingredients, ingredientSort]);

  // Фильтрация группы: совпадение по имени parent ИЛИ по имени любой
  // разновидности. Если совпало только по разновидности — parent остаётся
  // в выдаче, а при разворачивании видны все его items (не только совпавшие),
  // чтобы сохранить контекст группы.
  const visibleConsumptionData = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return consumptionData;
    return consumptionData.filter(group => {
      if (group.parentName.toLowerCase().includes(query)) return true;
      return group.items.some(item => item.name.toLowerCase().includes(query));
    });
  }, [consumptionData, searchQuery]);

  return (
    <div className="bg-kds-card p-6 rounded-lg border border-gray-800 mb-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h3 className="text-xl font-bold text-green-400 flex items-center gap-2">
          <Package size={22} /> Расход Ингредиентов
        </h3>
        {/* Поиск по названию ингредиента или его разновидности. */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск ингредиента..."
            className="bg-slate-900 border border-slate-700 text-white text-sm pl-9 pr-8 py-2 rounded-lg w-64 focus:border-green-500 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-white"
              title="Очистить"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {consumptionData.length === 0 ? (
        <div className="text-center py-8 text-slate-500 italic">Нет данных за этот период</div>
      ) : visibleConsumptionData.length === 0 ? (
        <div className="text-center py-8 text-slate-500 italic">Ничего не найдено по запросу «{searchQuery}»</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-700">
                <th
                  className="p-3 text-slate-400 font-bold uppercase text-xs cursor-pointer hover:text-white transition-colors whitespace-nowrap w-px"
                  onClick={() => handleIngredientSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Информация о Продукте
                    {ingredientSort.field === 'name' ? (
                      ingredientSort.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                    ) : <ArrowUpDown size={14} className="opacity-20" />}
                  </div>
                </th>
                <th
                  className="p-3 text-slate-400 font-bold uppercase text-xs text-right cursor-pointer hover:text-white transition-colors whitespace-nowrap w-px"
                  onClick={() => handleIngredientSort('weight')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Общий Вес
                    {ingredientSort.field === 'weight' ? (
                      ingredientSort.direction === 'asc' ? <ArrowUp size={14} className="text-blue-500" /> : <ArrowDown size={14} className="text-blue-500" />
                    ) : <ArrowUpDown size={14} className="opacity-20" />}
                  </div>
                </th>

                {/* Spacer */}
                <th className="p-3 w-full"></th>

                {/* Forecast Columns */}
                <th className="p-3 text-slate-400 font-bold uppercase text-xs text-center whitespace-nowrap w-32 border-l border-slate-800">
                  + %
                </th>
                <th className="p-3 text-slate-400 font-bold uppercase text-xs text-right whitespace-nowrap w-32">
                  Брутто
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visibleConsumptionData.map(group => {
                const isExpanded = expandedUsageGroups.has(group.groupId);

                const groupGross = group.items.reduce((sum, item) => {
                  return sum + calculateItemGross(item.totalWeightGrams, item.id);
                }, 0);

                const groupPercent = group.totalWeight > 0
                  ? ((groupGross - group.totalWeight) / group.totalWeight) * 100
                  : 0;

                return (
                  <React.Fragment key={group.groupId}>
                    <tr className="cursor-pointer transition-colors hover:bg-slate-800">
                      <td className="p-3 whitespace-nowrap" onClick={() => toggleUsageGroup(group.groupId)}>
                        <div className="flex items-center gap-3">
                          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRight size={16} className="text-slate-400" />
                          </div>
                          {group.parentImage ? (
                            <img src={group.parentImage} alt="" className="w-10 h-10 rounded object-cover border border-slate-700" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center border border-slate-700">
                              <Package size={20} className="text-slate-600" />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg text-white">
                                {group.parentName}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">{group.items.length} видов</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <span className="font-mono text-white font-bold text-lg">
                          {formatWeight(group.totalWeight)}
                        </span>
                      </td>

                      <td className="p-3 w-full"></td>

                      <td className="p-3 text-center border-l border-slate-800 bg-slate-900/30">
                        <div className="flex items-center justify-center">
                          <input
                            type="text"
                            readOnly
                            disabled
                            className="w-16 bg-slate-800/50 border border-slate-700 rounded text-center text-slate-400 font-mono cursor-not-allowed"
                            value={Math.abs(groupPercent) < 0.1 ? '0' : groupPercent.toFixed(1)}
                          />
                          <span className="text-slate-500 ml-1">%</span>
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono text-yellow-400 font-bold text-lg bg-slate-900/30">
                        {formatWeight(groupGross)}
                      </td>
                    </tr>

                    {isExpanded && group.items.map(item => {
                      const itemGross = calculateItemGross(item.totalWeightGrams, item.id);
                      return (
                        <tr key={item.id} className="bg-slate-900/30 hover:bg-slate-800/50 shadow-inner">
                          <td className="p-3 pl-16 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              {item.imageUrl && (
                                <img src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-slate-700 opacity-80" />
                              )}
                              <span className="text-slate-300 font-medium">{item.name}</span>
                            </div>
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            {formatWeight(item.totalWeightGrams)}
                          </td>

                          <td className="p-3 w-full"></td>

                          <td className="p-3 text-center border-l border-slate-800">
                            <div className="flex items-center justify-center">
                              <input
                                type="text"
                                placeholder="0"
                                className="w-14 py-0.5 bg-slate-900/80 border border-slate-700 rounded text-center text-white text-xs font-mono focus:border-blue-500 focus:outline-none"
                                value={bufferPercentages[item.id] || ''}
                                onChange={(e) => handleBufferChange(item.id, e.target.value)}
                                onBlur={() => handleBufferBlur(item.id)}
                              />
                            </div>
                          </td>
                          <td className="p-3 text-right font-mono text-yellow-600/80">
                            {formatWeight(itemGross)}
                          </td>
                        </tr>
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
  );
};
