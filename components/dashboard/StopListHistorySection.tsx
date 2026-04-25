import React, { useState, useMemo, useEffect } from 'react';
import { StopHistoryEntry, IngredientBase, Dish, SystemSettings } from '../../types';
import {
  calculateBusinessOverlap,
  formatDate,
  formatDuration,
  mergeIntervals,
  sumMergedMs,
  getStorageRank,
  getStorageRankLabel,
  DashboardHistoryEntry,
  DateGroup,
  HistoryGroup
} from './dashboardUtils';
import type { HistoryReport } from '../../services/excelExport';
import { ChevronRight, Package, Calendar, Search, X, User, UtensilsCrossed, Sprout, LayoutList } from 'lucide-react';

/**
 * Подпись актора для одной entry: «Поставил: Иванов · Снял: Петров».
 * Если оба NULL — возвращаем null (UI не рендерит блок).
 * Если только один известен — показываем только его.
 * Для kds-источника дополнительно помечаем, что снятие анонимное (rgst3
 * не пишет кто именно сделал DELETE).
 */
const ActorLine: React.FC<{ entry: DashboardHistoryEntry }> = ({ entry }) => {
  const stopped = entry.stoppedByName;
  const resumed = entry.resumedByName;
  if (!stopped && !resumed) return null;

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-1">
      {stopped && (
        <span className="inline-flex items-center gap-1">
          <User size={10} className="text-red-400/70" />
          <span className="text-slate-500">Поставил:</span>
          <span className="text-slate-300 font-medium">{stopped}</span>
          {entry.actorSource === 'kds' && (
            <span className="text-[9px] uppercase tracking-wider text-blue-400/70 ml-1">KDS</span>
          )}
          {entry.actorSource === 'cascade' && (
            <span className="text-[9px] uppercase tracking-wider text-orange-400/70 ml-1">каскад</span>
          )}
        </span>
      )}
      {resumed && (
        <span className="inline-flex items-center gap-1">
          <User size={10} className="text-green-400/70" />
          <span className="text-slate-500">Снял:</span>
          <span className="text-slate-300 font-medium">{resumed}</span>
        </span>
      )}
    </div>
  );
};

/** Режим группировки в «Истории Стоп-листов». */
type GroupMode = 'by-item' | 'by-date';

/**
 * Фильтр по типу записи: показывать всё подряд / только блюда / только ингредиенты.
 * Различение делается по префиксу `[DISH]` в `ingredientName`, который ставит
 * backend (routes/stoplist.ts → resolveDishName) для dish-записей. Ингредиенты
 * приходят без префикса.
 */
type TargetTypeFilter = 'all' | 'dish' | 'ingredient';

const MicroTimeline: React.FC<{
  entries: DashboardHistoryEntry[];
  rangeStart: number;
  rangeEnd: number;
  settings: SystemSettings;
}> = ({ entries, rangeStart, rangeEnd, settings }) => {
  // Открыто/закрыто вытащим один раз — раньше одни и те же defaults
  // подставлялись 2N раз внутри цикла. Для годового отчёта с сотнями
  // стопов это заметная экономия.
  const openTime  = settings.restaurantOpenTime  || '12:00';
  const closeTime = settings.restaurantCloseTime || '23:59';
  const excluded  = settings.excludedDates;

  // totalBusinessDuration — один на всю шкалу. Мемоизируем через useMemo,
  // чтобы при ре-рендере таблицы (смена expandedCategories и т.п.)
  // не пересчитывать заново O(N_days).
  const totalBusinessDuration = React.useMemo(
    () => calculateBusinessOverlap(rangeStart, rangeEnd, openTime, closeTime, excluded),
    [rangeStart, rangeEnd, openTime, closeTime, excluded]
  );

  if (rangeEnd <= rangeStart) return <div className="h-1.5 w-full bg-slate-800 rounded opacity-50"></div>;
  if (totalBusinessDuration <= 0) return <div className="h-1.5 w-full bg-slate-800 rounded opacity-30" title="Outside Business Hours"></div>;

  return (
    <div className="relative w-full h-2 bg-slate-800/60 rounded overflow-hidden flex items-center" title="Activity Timeline (Squeezed to Business Hours)">
      <div className="absolute inset-0 w-full h-full bg-slate-800/30"></div>

      {entries.map((entry, idx) => {
        const start = Math.max(rangeStart, entry.stoppedAt);
        // Для активных entry.resumedAt уже содержит reportTime (выставляется
        // в filteredHistory). Раньше был Date.now() — рассинхрон с
        // HistoryGroupRow.percentStopped на секунды. Теперь источник один.
        const effectiveEnd = entry.isActive ? Math.min(rangeEnd, entry.resumedAt) : entry.resumedAt;
        const end = Math.min(rangeEnd, effectiveEnd);

        if (end <= start) return null;

        const businessOffsetStart = calculateBusinessOverlap(rangeStart, start, openTime, closeTime, excluded);
        const businessDuration    = calculateBusinessOverlap(start, end, openTime, closeTime, excluded);

        if (businessDuration <= 0) return null;

        const leftPercent = (businessOffsetStart / totalBusinessDuration) * 100;
        const widthPercent = (businessDuration / totalBusinessDuration) * 100;

        return (
          <div
            key={entry.id || idx}
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
          {dateGroup.stopCount} раз
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
            <ActorLine entry={entry} />
          </td>
          <td className="px-6 py-3 text-right font-mono text-gray-300 text-base">
            {formatDuration(entry.durationMs)}
          </td>
        </tr>
      ))}
    </React.Fragment>
  );
};

/**
 * Строка режима группировки «по датам» (GroupMode = 'by-date').
 *
 * Формат:
 *   ▸ <дата> • <N стопов> • <totalDuration>
 *       └ имя блюда/ингредиента — reason — time range — duration
 *       └ ...
 *
 * Используем ту же структуру DateGroup что и в by-item режиме, только
 * здесь DateGroup верхнеуровневый, а не вложенный в HistoryGroup.
 * Внутри — плоский список entries этого дня с их именами.
 */

/**
 * Строка-разделитель между группами в Истории Стоп-листов: «Ингредиенты»,
 * «Кухня», «Бар», «Прочие склады», «Без склада». Подсвечивается ярче
 * обычных строк, чтобы было сразу видно где заканчивается одна секция и
 * начинается другая. colSpan=4 покрывает все колонки таблицы.
 *
 * compact=true — короче по высоте, для использования внутри развёрнутого
 * дня в by-date режиме (там разделители вторичны).
 */
const SectionHeaderRow: React.FC<{ rank: number; compact?: boolean }> = ({ rank, compact }) => {
  const label = getStorageRankLabel(rank);
  // Цветовая подсветка по рангу — тонкая, чтобы не перетягивала внимание
  // с самих строк, но позволяла «глазом сразу найти границу».
  const bgClass = (() => {
    switch (rank) {
      case 0: return 'bg-emerald-900/30 text-emerald-300';
      case 1: return 'bg-orange-900/30 text-orange-300';
      case 2: return 'bg-cyan-900/30 text-cyan-300';
      case 3: return 'bg-slate-700/40 text-slate-300';
      default: return 'bg-slate-800/50 text-slate-400';
    }
  })();
  return (
    <tr className={bgClass}>
      <td
        colSpan={4}
        className={`${compact ? 'px-6 py-1.5' : 'px-6 py-2'} text-xs font-bold uppercase tracking-widest border-y border-slate-700/60`}
      >
        ── {label} ──
      </td>
    </tr>
  );
};

const ByDateGroupRow: React.FC<{
  dateGroup: DateGroup;
}> = ({ dateGroup }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Сортируем entries внутри дня:
  //  1. Активные наверху.
  //  2. По типу/складу (ингредиенты → Кухня → Бар → прочие).
  //  3. По времени начала DESC.
  const sortedEntries = [...dateGroup.entries].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const rankA = getStorageRank(a);
    const rankB = getStorageRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return b.stoppedAt - a.stoppedAt;
  });

  return (
    <React.Fragment>
      <tr
        className={`cursor-pointer transition-colors border-b border-gray-800 group
                    bg-slate-800/10 hover:bg-slate-800/20
                    ${isExpanded ? 'bg-slate-800/30' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td className="px-6 py-5 font-bold text-white flex items-center gap-3 text-xl">
          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={24} className="text-slate-400" />
          </div>
          <span className="text-blue-400">{dateGroup.dateStr}</span>
        </td>
        <td className="px-6 py-5 text-gray-400 font-mono text-base">
          {dateGroup.stopCount} раз
        </td>
        <td className="px-6 py-5 text-gray-500 italic text-sm">
          {/* В by-date режиме таймлайн нерелевантен — один день — одна метка */}
          {new Set(sortedEntries.map(e => e.ingredientName)).size} продукт(ов)
        </td>
        <td className="px-6 py-5 text-right font-mono text-yellow-500 text-xl font-bold">
          {formatDuration(dateGroup.totalDuration)}
        </td>
      </tr>

      {isExpanded && (() => {
        // Вставляем разделители между секциями ранга — внутри развёрнутого дня.
        // compact=true делает строки короче, чтобы не «съедали» вертикальное
        // пространство (внутри дня их может быть несколько).
        const rows: React.ReactNode[] = [];
        let lastRank: number | null = null;
        for (let idx = 0; idx < sortedEntries.length; idx++) {
          const entry = sortedEntries[idx];
          const currentRank = getStorageRank(entry);
          if (currentRank !== lastRank) {
            rows.push(<SectionHeaderRow key={`${dateGroup.dateStr}-section-${currentRank}`} rank={currentRank} compact />);
            lastRank = currentRank;
          }
          rows.push(
            <tr
              key={`${dateGroup.dateStr}-${entry.id || idx}`}
              className="bg-slate-900/30 border-b border-gray-800/30 text-base hover:bg-slate-800/40"
            >
              <td className="px-6 py-3 pl-16 text-base">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{entry.ingredientName}</span>
                  {entry.isActive && <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{entry.reason || 'N/A'}</div>
              </td>
              <td className="px-6 py-3"></td>
              <td className="px-6 py-3 font-mono text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-blue-300">{formatDate(entry.stoppedAt)}</span>
                  <span className="text-gray-600">→</span>
                  {entry.isActive ? (
                    <span className="text-orange-500 font-bold animate-pulse text-sm uppercase tracking-wider">Active</span>
                  ) : (
                    <span className="text-green-300">{formatDate(entry.resumedAt)}</span>
                  )}
                </div>
                <ActorLine entry={entry} />
              </td>
              <td className="px-6 py-3 text-right font-mono text-gray-300">
                {formatDuration(entry.durationMs)}
              </td>
            </tr>
          );
        }
        return rows;
      })()}
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

  // Сливаем перекрывающиеся интервалы entries в union, потом для каждого
  // непересекающегося отрезка считаем бизнес-overlap. Без merge два
  // совпадающих стопа давали бы 200%, а % > 100 это бред.
  const actualStoppedMs = mergeIntervals(
    group.entries.map(e => ({
      stoppedAt: e.stoppedAt,
      resumedAt: e.isActive ? effectiveRangeEnd : e.resumedAt,
    }))
  ).reduce((sum, [start, end]) => {
    const clippedStart = Math.max(rangeStart, start);
    const clippedEnd = Math.min(effectiveRangeEnd, end);
    if (clippedEnd > clippedStart) {
      return sum + calculateBusinessOverlap(
        clippedStart,
        clippedEnd,
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
          {group.stopCount} раз
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
  /**
   * Подписка для Excel-экспорта. Передаём `searchedHistory` (после period+type+search
   * фильтров) + текущие настройки UI (groupMode, targetTypeFilter, searchQuery), чтобы
   * лист повторил иерархию которую видит пользователь.
   */
  onDataReady?: (data: HistoryReport) => void;
}

export const StopListHistorySection: React.FC<StopListHistorySectionProps> = ({ stopHistory, ingredients, dishes, appliedFilter, settings, onDataReady }) => {
  // Режим группировки: 'by-item' — как раньше (имя блюда/ингредиента → даты),
  // 'by-date' — обратная иерархия (дата → имена). Переключается тублером.
  const [groupMode, setGroupMode] = useState<GroupMode>('by-item');

  // Поиск по имени блюда/ингредиента. Фильтр применяется к entries до
  // группировки — в режиме «по датам» день останется в выдаче только если
  // в нём есть entries подходящие под запрос.
  const [searchQuery, setSearchQuery] = useState('');

  // Фильтр по типу: всё / только блюда (с префиксом [DISH]) / только ингредиенты.
  // Применяется поверх filteredHistory вместе с поисковым запросом.
  const [targetTypeFilter, setTargetTypeFilter] = useState<TargetTypeFilter>('all');

  const filteredHistory = useMemo(() => {
    if (!appliedFilter) return [];

    const startTime = appliedFilter.start ? new Date(appliedFilter.start).getTime() : 0;
    const endTime = appliedFilter.end ? new Date(appliedFilter.end).getTime() : Infinity;
    const reportTime = appliedFilter.timestamp;

    // Завершённые стопы: фильтр по пересечению интервала [stoppedAt; resumedAt]
    // с [startTime; endTime]. Backend уже отдал правильный набор через
    // серверный фильтр (Dashboard → fetchStopHistory(from, to)), но на случай
    // локально загруженной истории / гонки данных повторяем фильтр на фронте.
    const completed: DashboardHistoryEntry[] = stopHistory
      .filter(entry => entry.stoppedAt <= endTime && entry.resumedAt >= startTime)
      .map(entry => ({ ...entry, isActive: false }));

    // Активные стопы в отчёте: всё что ещё на стопе прямо сейчас и пересекается
    // с выбранным периодом. Стоп, начавшийся раньше startTime, но ещё не
    // снятый, тоже виден — иначе на «отчёт за сегодня» с активным вчерашним
    // стопом будет ложно казаться что простоя нет.
    //
    // Правила фильтра:
    //   - stop_timestamp <= endTime   — стоп начался до конца периода
    //   - stop_timestamp <= reportTime — и до момента формирования отчёта
    //   Стоп, начавшийся до startTime, тоже проходит — он покрывает часть
    //   периода. Таймлайн MicroTimeline и % downtime уже clip'аются по
    //   rangeStart через calculateBusinessOverlap, поэтому durationMs здесь
    //   оставляем полный (симметрично с row.duration_ms для завершённых).
    const activeIngredients: DashboardHistoryEntry[] = ingredients
      .filter(i => i.is_stopped && i.stop_timestamp)
      .filter(i => i.stop_timestamp! <= endTime)
      .filter(i => i.stop_timestamp! <= reportTime)
      .map(i => ({
        id: `active_ing_${i.id}`,
        ingredientName: i.name,
        stoppedAt: i.stop_timestamp!,
        resumedAt: reportTime,
        reason: i.stop_reason || 'Unknown',
        durationMs: reportTime - i.stop_timestamp!,
        isActive: true,
      }));

    const activeDishes: DashboardHistoryEntry[] = dishes
      .filter(d => d.is_stopped && d.stop_timestamp)
      .filter(d => d.stop_timestamp! <= endTime)
      .filter(d => d.stop_timestamp! <= reportTime)
      .map(d => ({
        id: `active_dish_${d.id}`,
        ingredientName: `[DISH] ${d.name}`,
        stoppedAt: d.stop_timestamp!,
        resumedAt: reportTime,
        reason: d.stop_reason || 'Manual',
        durationMs: reportTime - d.stop_timestamp!,
        isActive: true,
      }));

    return [...completed, ...activeIngredients, ...activeDishes].sort((a, b) => b.stoppedAt - a.stoppedAt);
  }, [stopHistory, ingredients, dishes, appliedFilter]);

  // Фильтр по типу + поиску поверх filteredHistory. Сделано одним useMemo
  // чтобы агрегация по группам (которая выполняется в render) всегда шла
  // по уже отфильтрованному набору — тогда и счётчики «N раз», и таймлайн
  // отражают именно то что видит пользователь.
  const searchedHistory = useMemo(() => {
    let result = filteredHistory;

    // Фильтр по типу записи. Префикс «[DISH] » ставится backend'ом для
    // dish-записей в slicer_stop_history, активные dish-стопы добавляются
    // на фронте с тем же префиксом (см. activeDishes выше).
    if (targetTypeFilter !== 'all') {
      result = result.filter(e => {
        const isDish = e.ingredientName.startsWith('[DISH]');
        return targetTypeFilter === 'dish' ? isDish : !isDish;
      });
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter(e => e.ingredientName.toLowerCase().includes(query));
    }

    return result;
  }, [filteredHistory, searchQuery, targetTypeFilter]);

  // Подписка для Excel-экспорта — передаём то, что видит пользователь:
  // searchedHistory + текущие UI-настройки фильтра/группировки.
  useEffect(() => {
    if (!onDataReady) return;
    onDataReady({
      entries: searchedHistory,
      groupMode,
      targetTypeFilter,
      searchQuery,
      rangeStart: appliedFilter.start ? new Date(appliedFilter.start).getTime() : 0,
      rangeEnd: appliedFilter.end ? new Date(appliedFilter.end).getTime() : Date.now(),
    });
  }, [searchedHistory, groupMode, targetTypeFilter, searchQuery, appliedFilter, onDataReady]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <h3 className="text-xl font-bold text-red-400">История Стоп-листов</h3>
        <div className="flex items-center gap-4 text-xs font-mono">
          {/* Поиск по имени блюда/ингредиента — работает в обоих режимах
              группировки (по продуктам / по датам). */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              className="bg-slate-900 border border-slate-700 text-white text-xs pl-8 pr-7 py-1.5 rounded-lg w-56 focus:border-red-500 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-white"
                title="Очистить"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {/* Фильтр по типу записи: всё / только блюда / только ингредиенты.
              Стилистика — как у тумблера группировки ниже (button group). */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700 bg-slate-900">
            <button
              type="button"
              onClick={() => setTargetTypeFilter('all')}
              title="Показать все записи"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                targetTypeFilter === 'all'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-900 text-gray-400 hover:text-white'
              }`}
            >
              <LayoutList size={14} /> Всё
            </button>
            <button
              type="button"
              onClick={() => setTargetTypeFilter('dish')}
              title="Показать только стопы блюд"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                targetTypeFilter === 'dish'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-900 text-gray-400 hover:text-white'
              }`}
            >
              <UtensilsCrossed size={14} /> Блюда
            </button>
            <button
              type="button"
              onClick={() => setTargetTypeFilter('ingredient')}
              title="Показать только стопы ингредиентов"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                targetTypeFilter === 'ingredient'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-900 text-gray-400 hover:text-white'
              }`}
            >
              <Sprout size={14} /> Ингредиенты
            </button>
          </div>
          {/* Тублер режима группировки. Две кнопки: по продуктам / по датам.
              Активная подсвечивается синим, неактивная — серая. Иконки
              (Package / Calendar) подсказывают модель. */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700 bg-slate-900">
            <button
              type="button"
              onClick={() => setGroupMode('by-item')}
              title="Группировать по блюду / ингредиенту"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                groupMode === 'by-item'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-gray-400 hover:text-white'
              }`}
            >
              <Package size={14} /> По продуктам
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('by-date')}
              title="Группировать по дате"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                groupMode === 'by-date'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-gray-400 hover:text-white'
              }`}
            >
              <Calendar size={14} /> По датам
            </button>
          </div>
          <span className="text-gray-500">Отчет сформирован: <span className="text-white">{formatDate(appliedFilter.timestamp)}</span></span>
          <span className="text-gray-500">Записи: <span className="text-white">{searchedHistory.length}</span></span>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-gray-800 bg-kds-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-800 text-gray-400 font-bold uppercase text-base">
              <tr>
                <th className="px-6 py-4 whitespace-nowrap w-[35%]">
                  {groupMode === 'by-item' ? 'Продукт' : 'Дата'}
                </th>
                <th className="px-6 py-4 whitespace-nowrap w-[10%]">Кол-во</th>
                <th className="px-6 py-4 whitespace-nowrap w-[35%]">
                  {groupMode === 'by-item' ? 'Таймлайн' : 'Продукты / время'}
                </th>
                <th className="px-6 py-4 whitespace-nowrap w-[20%] text-right">Длительность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {(() => {
                if (searchedHistory.length === 0) {
                  return (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">
                        {searchQuery.trim()
                          ? `Ничего не найдено по запросу «${searchQuery}»`
                          : 'Нет записей за выбранный период.'}
                      </td>
                    </tr>
                  );
                }

                // === Режим «по продуктам»: имя → даты → entries ===
                if (groupMode === 'by-item') {
                  const groupedHistory = searchedHistory.reduce<Record<string, HistoryGroup>>((acc, entry) => {
                    const key = entry.ingredientName;
                    if (!acc[key]) {
                      acc[key] = {
                        name: entry.ingredientName,
                        isActive: false,
                        entries: [],
                        totalDuration: 0,  // пересчитаем ниже через mergeIntervals
                        stopCount: 0,
                        dates: {}
                      };
                    }
                    acc[key].entries.push(entry);
                    acc[key].stopCount += 1;
                    if (entry.isActive) acc[key].isActive = true;

                    const dateObj = new Date(entry.stoppedAt);
                    const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

                    if (!acc[key].dates[dateStr]) {
                      acc[key].dates[dateStr] = {
                        dateStr,
                        totalDuration: 0,  // пересчитаем ниже
                        stopCount: 0,
                        entries: []
                      };
                    }
                    acc[key].dates[dateStr].entries.push(entry);
                    acc[key].dates[dateStr].stopCount += 1;

                    return acc;
                  }, {});

                  // Пересчёт totalDuration через union интервалов — чтобы
                  // перекрывающиеся стопы (типичный кейс когда в ctlg15_dishes
                  // два блюда с одинаковым именем и оба на стопе) не давали
                  // двойной подсчёт времени. stopCount остаётся как число
                  // событий (показывает активность кассира), totalDuration —
                  // фактический простой блюда.
                  for (const group of Object.values(groupedHistory) as HistoryGroup[]) {
                    group.totalDuration = sumMergedMs(group.entries);
                    for (const dateKey of Object.keys(group.dates)) {
                      group.dates[dateKey].totalDuration = sumMergedMs(group.dates[dateKey].entries);
                    }
                  }

                  // Сортировка групп:
                  //  1. Активные (стопится прямо сейчас) — наверх.
                  //  2. По типу/складу: ингредиенты → Кухня → Бар → прочие → без склада.
                  //     Все entries одной группы имеют одинаковое имя и, значит,
                  //     одинаковый набор storages — берём ранг с первого entry.
                  //  3. Внутри одинакового ранга — по длительности downtime DESC.
                  const sortedGroups = (Object.values(groupedHistory) as HistoryGroup[]).sort((a, b) => {
                    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                    const rankA = getStorageRank(a.entries[0]);
                    const rankB = getStorageRank(b.entries[0]);
                    if (rankA !== rankB) return rankA - rankB;
                    return b.totalDuration - a.totalDuration;
                  });

                  const timelineStart = appliedFilter.start ? new Date(appliedFilter.start).getTime() : (searchedHistory.length > 0 ? searchedHistory[searchedHistory.length - 1].stoppedAt : Date.now() - 86400000);
                  const timelineEnd = appliedFilter.end ? new Date(appliedFilter.end).getTime() : Date.now();

                  // Вставляем строку-разделитель ПЕРЕД первой группой каждого
                  // ранга. Активные стопы выводим отдельной секцией сверху —
                  // так пользователь не теряет красные «горящие» строки в
                  // середине списка после ранг-сортировки.
                  const elements: React.ReactNode[] = [];
                  let lastRank: number | 'active' | null = null;
                  for (const group of sortedGroups) {
                    const currentRank: number | 'active' = group.isActive ? 'active' : getStorageRank(group.entries[0]);
                    if (currentRank !== lastRank) {
                      if (currentRank === 'active') {
                        elements.push(
                          <tr key="section-active" className="bg-red-900/30 text-red-300">
                            <td colSpan={4} className="px-6 py-2 text-xs font-bold uppercase tracking-widest border-y border-red-700/40">
                              ── Активные сейчас ──
                            </td>
                          </tr>
                        );
                      } else {
                        elements.push(<SectionHeaderRow key={`section-${currentRank}`} rank={currentRank} />);
                      }
                      lastRank = currentRank;
                    }
                    elements.push(
                      <HistoryGroupRow
                        key={group.name}
                        group={group}
                        rangeStart={timelineStart}
                        rangeEnd={timelineEnd}
                        settings={settings}
                      />
                    );
                  }
                  return elements;
                }

                // === Режим «по датам»: дата → entries с именами ===
                // Одна запись попадает в день НАЧАЛА стопа (если стоп
                // через полночь — относим к первому дню, чтобы избежать
                // двойного учёта между датами).
                const byDate = searchedHistory.reduce<Record<string, DateGroup>>((acc, entry) => {
                  const dateObj = new Date(entry.stoppedAt);
                  const dateStr = dateObj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  if (!acc[dateStr]) {
                    acc[dateStr] = { dateStr, totalDuration: 0, stopCount: 0, entries: [] };
                  }
                  acc[dateStr].entries.push(entry);
                  acc[dateStr].stopCount += 1;
                  return acc;
                }, {});

                // TotalDuration дня = sum(union-по-имени для каждого блюда).
                // Разные блюда складываются (они не взаимозаменяемы), одно
                // и то же блюдо с дубль-стопами — union (избегаем двойного счёта).
                for (const dateGroup of Object.values(byDate) as DateGroup[]) {
                  const perName = new Map<string, DashboardHistoryEntry[]>();
                  for (const entry of dateGroup.entries) {
                    const list = perName.get(entry.ingredientName) || [];
                    list.push(entry);
                    perName.set(entry.ingredientName, list);
                  }
                  let sum = 0;
                  for (const list of perName.values()) sum += sumMergedMs(list);
                  dateGroup.totalDuration = sum;
                }

                const sortedDays = (Object.values(byDate) as DateGroup[]).sort((a, b) => {
                  const [d1, m1, y1] = a.dateStr.split('.').map(Number);
                  const [d2, m2, y2] = b.dateStr.split('.').map(Number);
                  return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
                });

                return sortedDays.map((dateGroup) => (
                  <ByDateGroupRow key={dateGroup.dateStr} dateGroup={dateGroup} />
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
