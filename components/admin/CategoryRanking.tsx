import React from 'react';
import { SystemSettings } from '../../types';

interface CategoryRankingProps {
  settings: SystemSettings;
  setSettings: (settings: SystemSettings) => void;
}

export const CategoryRanking: React.FC<CategoryRankingProps> = ({ settings, setSettings }) => {
  return (
    <div className="bg-kds-card rounded-lg p-6 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">Category & Priority Ranking</h2>

      <div className="space-y-6">
        <div className="border-b border-gray-700 pb-6">
          <label className="block text-gray-400 font-bold mb-4">Sorting Priority Rules</label>
          <div className="space-y-2 bg-gray-900/50 p-4 rounded-lg border border-gray-700">
            {(settings.activePriorityRules || ['ULTRA', 'FIFO']).map((rule, idx, arr) => {
              const moveUp = () => {
                if (idx === 0) return;
                const newRules = [...arr];
                [newRules[idx - 1], newRules[idx]] = [newRules[idx], newRules[idx - 1]];
                setSettings({ ...settings, activePriorityRules: newRules });
              };
              const moveDown = () => {
                if (idx === arr.length - 1) return;
                const newRules = [...arr];
                [newRules[idx + 1], newRules[idx]] = [newRules[idx], newRules[idx + 1]];
                setSettings({ ...settings, activePriorityRules: newRules });
              };

              const getLabel = (r: string) => {
                switch (r) {
                  case 'ULTRA': return '🚨 ULTRA (KDS Flag)';
                  case 'FIFO': return '⏱️ FIFO (По очереди)';
                  case 'COURSE_FIFO': return '🍽️ COURSE_FIFO (Курсы + FIFO)';
                  case 'CATEGORY': return '📂 Category Priority';
                  default: return r;
                }
              };

              return (
                <div key={rule} className="flex items-center justify-between bg-gray-800 p-3 rounded border border-gray-600">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 font-mono font-bold w-4">{idx + 1}.</span>
                    <span className="text-white font-bold">{getLabel(rule)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={moveUp}
                      disabled={idx === 0}
                      className="p-1 px-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white"
                    >
                      ↑
                    </button>
                    <button
                      onClick={moveDown}
                      disabled={idx === arr.length - 1}
                      className="p-1 px-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Кнопки добавления/удаления правил */}
          <div className="flex flex-wrap gap-2 mt-3">
            {!settings.activePriorityRules?.includes('COURSE_FIFO') && (
              <button
                onClick={() => setSettings({ ...settings, activePriorityRules: [...(settings.activePriorityRules || []), 'COURSE_FIFO'] })}
                className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 rounded text-sm border border-amber-600/50"
              >
                + COURSE_FIFO
              </button>
            )}
            {!settings.activePriorityRules?.includes('FIFO') && (
              <button
                onClick={() => setSettings({ ...settings, activePriorityRules: [...(settings.activePriorityRules || []), 'FIFO'] })}
                className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded text-sm border border-blue-600/50"
              >
                + FIFO
              </button>
            )}
            {!settings.activePriorityRules?.includes('CATEGORY') && (
              <button
                onClick={() => setSettings({ ...settings, activePriorityRules: [...(settings.activePriorityRules || []), 'CATEGORY'] })}
                className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded text-sm border border-purple-600/50"
              >
                + CATEGORY
              </button>
            )}
            {settings.activePriorityRules && settings.activePriorityRules.length > 1 && (
              <button
                onClick={() => {
                  const last = settings.activePriorityRules![settings.activePriorityRules!.length - 1];
                  if (last === 'ULTRA') return;
                  setSettings({ ...settings, activePriorityRules: settings.activePriorityRules!.slice(0, -1) });
                }}
                className="px-3 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded text-sm border border-red-600/50"
              >
                − Удалить последнее
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">Правила применяются сверху вниз. COURSE_FIFO = курсы внутри окна + FIFO между ними.</p>

          {/* Настройка окна COURSE_FIFO в секундах */}
          {settings.activePriorityRules?.includes('COURSE_FIFO') && (
            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-amber-600/30">
              <label className="block text-amber-300 font-bold mb-2">⏱️ Окно COURSE_FIFO (секунды)</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="10"
                  max="3600"
                  step="10"
                  value={settings.courseWindowSeconds || 300}
                  onChange={(e) => {
                    const val = Math.max(10, Math.min(3600, parseInt(e.target.value) || 300));
                    setSettings({ ...settings, courseWindowSeconds: val });
                  }}
                  className="w-24 bg-gray-800 text-white border border-gray-600 rounded px-3 py-2 text-center font-mono"
                />
                <span className="text-gray-400 text-sm">
                  = {Math.floor((settings.courseWindowSeconds || 300) / 60)} мин {(settings.courseWindowSeconds || 300) % 60 > 0 ? `${(settings.courseWindowSeconds || 300) % 60} сек` : ''}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Заказы в одном окне сортируются по курсу (суп→салат→горячее→десерт). Между окнами — по FIFO.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
