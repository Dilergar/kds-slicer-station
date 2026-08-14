import React, { useState } from 'react';
import { SystemSettings } from '../../types';
import { Check, Ban, Snowflake, Bell, Home, X } from 'lucide-react';
import { ClampedNumberInput } from '../ui/ClampedNumberInput';
import { HouseTableBadge } from '../ui/HouseTableBadge';

interface SystemSettingsTabProps {
  settings: SystemSettings;
  setSettings: (settings: SystemSettings) => void;
}

/** Верхняя граница номера стола — совпадает с проверкой в PUT /api/settings */
const MAX_TABLE_NUMBER = 9999;
/** Предел длины списка — совпадает с CHECK'ом миграции 030 */
const MAX_HOUSE_TABLES = 100;

export const SystemSettingsTab: React.FC<SystemSettingsTabProps> = ({ settings, setSettings }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  // ── Столы-домики (миграция 030) ────────────────────────────────────────────
  // Черновик поля ввода держим отдельно от настроек: настройки уходят на сервер
  // с дебаунсом 500 мс (App.tsx), и промежуточная «3» на пути к «33» успела бы
  // сохраниться как отдельный стол.
  const [houseTableDraft, setHouseTableDraft] = useState('');
  const [houseTableError, setHouseTableError] = useState<string | null>(null);
  const houseTables = settings.houseTables ?? [];

  /**
   * Добавляет номер из поля ввода в список столов-домиков.
   * Границы дублируют проверку API (1..9999, не более 100) — чтобы владелец
   * увидел причину сразу, а не молчаливый откат настроек после 400-ки.
   */
  const addHouseTable = () => {
    const raw = houseTableDraft.trim();
    if (!raw) return;
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 1 || num > MAX_TABLE_NUMBER) {
      setHouseTableError(`Номер стола — целое число от 1 до ${MAX_TABLE_NUMBER}`);
      return;
    }
    if (houseTables.includes(num)) {
      setHouseTableError(`Стол ${num} уже в списке`);
      return;
    }
    if (houseTables.length >= MAX_HOUSE_TABLES) {
      setHouseTableError(`Больше ${MAX_HOUSE_TABLES} столов добавить нельзя`);
      return;
    }
    // Сортировка — чтобы список читался как рассадка, а не как история правок
    setSettings({ ...settings, houseTables: [...houseTables, num].sort((a, b) => a - b) });
    setHouseTableDraft('');
    setHouseTableError(null);
  };

  /**
   * Убирает стол из списка домиков — его номер снова рисуется обычным жёлтым.
   * @param num Номер стола
   */
  const removeHouseTable = (num: number) => {
    setSettings({ ...settings, houseTables: houseTables.filter(t => t !== num) });
    setHouseTableError(null);
  };

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
          <ClampedNumberInput
            value={settings.historyRetentionMinutes || 60}
            min={1}
            max={120}
            fallback={60}
            aria-label="Хранение истории в минутах"
            onCommit={(val) => setSettings({ ...settings, historyRetentionMinutes: val })}
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

        {/* Звук при новом заказе (миграция 026) — двойной beep при появлении
            нового заказа на доске. Логика — эффект knownOrderIdsRef в
            SlicerStation; паттерн звука отличается от сигнала разморозки,
            чтобы события различались на слух. */}
        <div className="border-t border-gray-700 pt-6">
          <div className="flex justify-between items-start">
            <div>
              <label className="block text-gray-400 text-sm font-bold mb-1 flex items-center gap-2">
                <Bell size={16} className="text-yellow-400" />
                Звук при новом заказе
              </label>
              <p className="text-gray-500 text-xs max-w-md">
                Двойной сигнал, когда на доску приходит новый заказ. Помогает не пропустить позицию в шумной кухне, не глядя в планшет. Звучит иначе, чем сигнал разморозки.
              </p>
            </div>
            <div className="flex items-center bg-gray-900 rounded-lg p-1 border border-gray-700 ml-4">
              <button
                onClick={() => setSettings({ ...settings, enableNewOrderSound: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  settings.enableNewOrderSound === false
                    ? 'bg-red-900/80 text-red-100 shadow-[0_0_10px_rgba(153,27,27,0.4)]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                ВЫКЛ
              </button>
              <button
                onClick={() => setSettings({ ...settings, enableNewOrderSound: true })}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  settings.enableNewOrderSound !== false
                    ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                ВКЛ
              </button>
            </div>
          </div>
        </div>

        {/* Столы-домики (миграция 030). Номер такого стола рисуется на карточке
            кирпичным в рамке-домике — нарезчик видит «это в домик на улице»
            прямо по номеру. Метка касается ТОЛЬКО номера стола: рамка карточки,
            мини-ряд разморозки, панель парковки и история не меняются. */}
        <div className="border-t border-gray-700 pt-6">
          <label className="block text-gray-400 text-sm font-bold mb-1 flex items-center gap-2">
            <Home size={16} style={{ color: '#E2725B' }} />
            Столы-домики
          </label>
          <p className="text-gray-500 text-xs max-w-md mb-4">
            Номера столов, которые стоят отдельными домиками. На карточке заказа такой номер
            рисуется кирпичным цветом в рамке в форме домика вместо обычного жёлтого. Остальное
            оформление карточки не меняется. Пустой список — меток нет.
          </p>

          {/* Текущий список. Значок — тот же компонент, что и на доске:
              владелец видит ровно то, что увидит нарезчик. */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {houseTables.length === 0 ? (
              <span className="text-gray-600 text-sm italic">Столов-домиков пока нет</span>
            ) : (
              houseTables.map(num => (
                <span
                  key={num}
                  className="inline-flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-lg pl-1 pr-1 py-1"
                >
                  <HouseTableBadge num={num} />
                  <button
                    onClick={() => removeHouseTable(num)}
                    className="text-gray-500 hover:text-red-400 transition-colors p-0.5 rounded"
                    title={`Убрать стол ${num} из домиков`}
                    aria-label={`Убрать стол ${num} из домиков`}
                  >
                    <X size={14} />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Добавление. Enter работает наравне с кнопкой — на планшете с
              экранной клавиатурой это привычнее, чем целиться в кнопку. */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              value={houseTableDraft}
              onChange={(e) => {
                setHouseTableDraft(e.target.value);
                setHouseTableError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addHouseTable();
                }
              }}
              placeholder="Напр. 33"
              aria-label="Номер стола-домика"
              className="w-32 bg-gray-900 border border-gray-700 text-white p-2 rounded focus:border-blue-500 outline-none font-mono"
            />
            <button
              onClick={addHouseTable}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded transition-colors"
            >
              Добавить
            </button>
          </div>
          {houseTableError && (
            <p className="text-red-400 text-xs mt-2">{houseTableError}</p>
          )}
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
              <ClampedNumberInput
                value={coursePace}
                min={10}
                max={3600}
                step={10}
                fallback={600}
                aria-label="Шаг курса в секундах"
                onCommit={(val) => setSettings({ ...settings, coursePaceSeconds: val })}
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
