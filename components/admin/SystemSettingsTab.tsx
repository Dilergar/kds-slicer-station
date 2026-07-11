import React, { useState } from 'react';
import { SystemSettings } from '../../types';
import { Check, Ban, Snowflake } from 'lucide-react';

interface SystemSettingsTabProps {
  settings: SystemSettings;
  setSettings: (settings: SystemSettings) => void;
}

export const SystemSettingsTab: React.FC<SystemSettingsTabProps> = ({ settings, setSettings }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  // Шаг курса умной очереди с фолбэком на дефолт БД (600, миграция 024) —
  // одно место вместо четырёх повторов `?? 600` в блоке ниже (инпут, подпись
  // «мин/сек», onChange), которые могли разъехаться при правке дефолта.
  const coursePace = settings.coursePaceSeconds ?? 600;

  return (
    <div className="bg-kds-card rounded-lg p-6 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">Общие Настройки</h2>

      <div className="space-y-8">
        {/* 1. Business Hours */}
        <div className="border-b border-gray-700 pb-8">
          <label className="block text-gray-400 font-bold mb-4">Время работы ресторана</label>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Время открытия</label>
              <input
                type="time"
                value={settings.restaurantOpenTime || "12:00"}
                onChange={(e) => setSettings({ ...settings, restaurantOpenTime: e.target.value })}
                className="bg-gray-900 border border-gray-700 text-white p-3 rounded w-full focus:border-blue-500 outline-none font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Время закрытия</label>
              <input
                type="time"
                value={settings.restaurantCloseTime || "00:00"}
                onChange={(e) => setSettings({ ...settings, restaurantCloseTime: e.target.value })}
                className="bg-gray-900 border border-gray-700 text-white p-3 rounded w-full focus:border-blue-500 outline-none font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Downtime KPI будет рассчитываться только в эти часы.</p>
        </div>

        {/* 2. Excluded Dates Calendar */}
        <div className="border-b border-gray-700 pb-8">
          <label className="block text-gray-400 font-bold mb-4">Исключенные Дни (Выходные / Праздники)</label>
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
                &lt; Пред
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
                След &gt;
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
                <span className="text-gray-400">Рабочий день</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-900/50 rounded border border-red-500"></div>
                <span className="text-gray-400">Исключенный день</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Other Settings */}
        <div>
          <label className="block text-gray-400 font-bold mb-2">Хранение истории (минуты)</label>
          <p className="text-xs text-gray-500 mb-2">Как долго отданные заказы висят на доске истории (Макс 120 мин).</p>
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

        {/* Разморозка (миграции 016, 020) — глобальный тумблер звука.
            Время разморозки задаётся per-dish в RecipeEditor (миграция 020),
            здесь осталась только настройка звукового сигнала. */}
        <div className="border-t border-gray-700 pt-6">
          <div className="flex justify-between items-start">
            <div>
              <label className="block text-gray-400 text-sm font-bold mb-1 flex items-center gap-2">
                <Snowflake size={16} className="text-blue-400" />
                Звук при готовности разморозки
              </label>
              <p className="text-gray-500 text-xs max-w-md">
                Короткий сигнал когда таймер на мини-карточке достиг 0. Помогает не пропустить готовую рыбу в шумной кухне.
                Время разморозки настраивается отдельно для каждого блюда в разделе «Рецепты».
              </p>
            </div>
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableDefrostSound: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  settings.enableDefrostSound === false
                    ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                ВЫКЛ
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableDefrostSound: true })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  settings.enableDefrostSound !== false
                    ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                ВКЛ
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <label className="block text-gray-400 text-sm font-bold mb-1">
                Окно Агрегации (Режим скорости)
              </label>
              <p className="text-gray-500 text-sm mb-3 max-w-md">
                Задача — отдать все блюда быстрее: одинаковые блюда с разных столов объединяются в одну карточку (без ограничения по времени), порядок категорий (суп→горячее) не сохраняется. Карточки идут строго по времени первого заказа — никто не «сползает» вниз.
              </p>
            </div>
            {/* On/Off Toggle.
                Подсветка по строгому `=== true`: раньше условие `!== false`
                подсвечивало ВКЛ при undefined, и оба взаимоисключающих
                тумблера («Окно Агрегации» и «Волновая») могли гореть
                зелёным одновременно. */}
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableAggregation !== true
                  ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ВЫКЛ
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableAggregation: true, enableSmartAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableAggregation === true
                  ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(22,163,74,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ВКЛ
              </button>
            </div>
          </div>

          {/* Поле «минут» удалено (2026-07-06): по решению владельца слияние
              в режиме скорости безлимитное — пока карточка не отдана, новые
              порции того же блюда вливаются к ней. Колонка
              aggregation_window_minutes осталась в БД как легаси и кодом не
              используется. */}

          {/* Smart Wave Aggregation Toggle */}
          <div className="flex justify-between items-start mt-6 mb-2 pt-6 border-t border-slate-700/50">
            <div>
              <div className="flex items-center">
                <label className="block text-gray-400 text-sm font-bold mb-1">
                  Волновая Агрегация (Умная)
                </label>
                <span className="ml-2 bg-yellow-500/20 text-yellow-300 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider border border-yellow-500/30">Новое</span>
              </div>
              <p className="text-gray-500 text-sm mb-3 max-w-md">
                Каждый стол обслуживается по своим курсам (суп→салат→горячее→десерт), одинаковые блюда объединяются, если это не ломает порядок курсов. Стол с одним десертом не ждёт полные обеды соседей, а большой стол не голодает из-за потока новых. Темп задаётся «шагом курса» ниже.
              </p>
            </div>
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableSmartAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableSmartAggregation !== true
                  ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ВЫКЛ
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableSmartAggregation: true, enableAggregation: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${settings.enableSmartAggregation === true
                  ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                ВКЛ
              </button>
            </div>
          </div>

          {/* Шаг курса — параметр умной очереди v2 «Темп курсов» (миграции 023/024).
              Семантика уточнена 2026-07-11: это «окно уступки» поздних курсов
              стола первым курсам более новых гостей, а не «время еды гостя».
              Показываем только когда умная включена (иначе не влияет ни на что). */}
          <div className={`transition-all duration-300 ${settings.enableSmartAggregation === true ? 'opacity-100' : 'opacity-30 grayscale pointer-events-none select-none'} mt-2 p-4 bg-gray-900/50 rounded-lg border border-blue-600/30`}>
            <label className="block text-blue-300 font-bold mb-2 text-sm">⏱️ Шаг курса — окно уступки (секунды)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="10"
                max="3600"
                step="10"
                value={coursePace}
                onChange={(e) => {
                  const val = Math.max(10, Math.min(3600, parseInt(e.target.value) || 600));
                  setSettings({ ...settings, coursePaceSeconds: val });
                }}
                className="w-24 bg-gray-800 text-white border border-gray-600 rounded px-3 py-2 text-center font-mono"
              />
              <span className="text-gray-400 text-sm">
                = {Math.floor(coursePace / 60)} мин {coursePace % 60 > 0 ? `${coursePace % 60} сек` : ''}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2 max-w-md">
              На сколько следующий курс стола уступает дорогу гостям, пришедшим позже. Первый курс стола встаёт в очередь по времени пробития, курс N — на N×шаг позже. Пока это время не наступило, первые блюда новых столов проходят вперёд; после — позицию уже никто не обгонит. На скорость нарезки не влияет: при свободной очереди блюдо режется сразу.
            </p>
            <ul className="text-xs text-gray-500 mt-1 max-w-md list-disc list-inside space-y-0.5">
              <li><b className="text-gray-400">Больше</b> (напр. 600 сек) — новые гости быстрее получают первые блюда; вторые-третьи курсы больших столов дольше уступают в час пик.</li>
              <li><b className="text-gray-400">Меньше</b> (напр. 120 сек) — очередь ближе к «стол за столом»: поздние курсы стола держатся вплотную к его первому, коротким заказам новичков приходится ждать чужие обеды.</li>
            </ul>
            <p className="text-xs text-gray-600 mt-1">Рекомендуется 600 сек (10 мин). Не влияет на режим скорости и стандартную сортировку.</p>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
          <p className="text-green-400 text-sm flex items-center gap-2">
            <Check size={16} />
            Настройки сохраняются автоматически
          </p>
        </div>
      </div>
    </div>
  );
};
