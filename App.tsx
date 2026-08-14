/**
 * App.tsx — Корневой компонент приложения KDS Slicer Station
 *
 * Роутинг вьюшек и подключение кастомных хуков.
 * Данные загружаются из PostgreSQL через API (backend на порту 3001).
 * Бизнес-логика вынесена в /hooks:
 * - useIngredients: CRUD ингредиентов (slicer_ingredients)
 * - useStopList: Управление стоп-листами и авто-стоп блюд
 * - useOrders: Заказы (polling из docm2_orders), парковка, история
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ViewMode, Dish, Category, SystemSettings } from './types';
import { Navigation } from './components/Navigation';
import { SlicerStation } from './components/SlicerStation';
import { StopListManager } from './components/StopListManager';
import { AdminPanel } from './components/AdminPanel';
import { Dashboard } from './components/Dashboard';
import { LoginScreen } from './components/LoginScreen';
import { Check, LogOut, Ban } from 'lucide-react';

import { useIngredients } from './hooks/useIngredients';
import { useStopList } from './hooks/useStopList';
import { useOrders } from './hooks/useOrders';
import { useAuth } from './hooks/useAuth';

import { fetchCategories } from './services/categoriesApi';
import { fetchSettings, updateSettings } from './services/settingsApi';
import { fetchDishes } from './services/dishesApi';
import { getAllowedViews } from './constants';
import { installAudioUnlock } from './utils';

function App() {
  // === Авторизация — PIN из чужой таблицы `users` (см. hooks/useAuth.ts) ===
  const { user, login, logout } = useAuth();

  // Разблокировка звука на первом касании экрана. Браузер не даёт играть звук
  // до жеста пользователя, а сигналы у нас инициирует поллинг — без этого
  // первый заказ утром приходил бы молча (см. installAudioUnlock в utils.ts).
  useEffect(() => installAudioUnlock(), []);

  // Список разрешённых вкладок для залогиненного юзера.
  // Считается даже когда user=null (даст []), чтобы не ломать мемо-цепочку,
  // но фактически не используется до входа — LoginScreen рендерится раньше.
  const allowedViews = useMemo(
    () => (user ? getAllowedViews(user.roles) : []),
    [user]
  );

  // === Текущий режим отображения (KDS | STOPLIST | ADMIN | DASHBOARD) ===
  const [currentView, setCurrentView] = useState<ViewMode>('KDS');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Если у юзера нет прав на текущую вкладку (например, Официант залогинился
  // после Администратора на том же планшете, а в localStorage остался
  // currentView='ADMIN'), — мягко переключаем на первую доступную.
  useEffect(() => {
    if (!user) return;
    if (allowedViews.length > 0 && !allowedViews.includes(currentView)) {
      setCurrentView(allowedViews[0]);
    }
  }, [user, allowedViews, currentView]);

  // === Данные, загружаемые из API ===
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const dishMap = useMemo(() => new Map(dishes.map(d => [d.id, d])), [dishes]);

  // Флаг: настройки реально подтянулись из БД. Пока false — НИ ОДИН экран
  // не рендерится (глобальный гейт ниже): раньше гейт закрывал только
  // ADMIN/DASHBOARD, и KDS-доска первые мгновения строила очередь по
  // захардкоженным дефолтам, а не по значениям из slicer_settings.
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // === Системные настройки (загружаются из slicer_settings) ===
  // Начальные значения ИНЕРТНЫ: до settingsLoaded=true ни один экран не
  // рендерится, поэтому эти числа ни на что не влияют. Истина всегда в БД —
  // в частности, у окна COURSE_FIFO нет «дефолта», используется то, что
  // указано в UI-настройках (см. CLAUDE.md, паттерн 8).
  const [settings, setSettings] = useState<SystemSettings>({
    aggregationWindowMinutes: 5,
    historyRetentionMinutes: 15,
    activePriorityRules: ['ULTRA', 'COURSE_FIFO'],
    courseWindowSeconds: 10,
    coursePaceSeconds: 600,
    restaurantOpenTime: '12:00',
    restaurantCloseTime: '23:59',
    excludedDates: [],
    enableAggregation: false,
    enableSmartAggregation: true
  });

  // Таймер для дебаунса PUT /api/settings — числовые инпуты (courseWindowSeconds,
  // aggregationWindowMinutes) дёргают onChange на каждую цифру, без дебаунса
  // улетит 5-10 запросов на один ввод значения.
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Сообщение о неудачном сохранении настроек ('' — всё в порядке) */
  const [settingsError, setSettingsError] = useState('');

  // Зеркало текущих настроек для расчёта патча без лишних зависимостей эффекта
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Накопленные изменённые поля между вызовами дебаунса.
  // Отправляем ТОЛЬКО их, а не весь объект настроек.
  const pendingPatchRef = useRef<Partial<SystemSettings>>({});

  /**
   * Обёртка над setSettings: мгновенно обновляет локальный стейт (оптимистично)
   * и с дебаунсом 500 мс отправляет PUT /api/settings для персиста в БД.
   * При ошибке сети откатывает стейт на свежее значение из БД через fetchSettings.
   *
   * ⚠️ Отправляется ПАТЧ, а не весь объект. Раньше при изменении одного тумблера
   * на сервер уходили все настройки целиком, а сервер применяет каждое непустое
   * поле через COALESCE. Локальная копия настроек при этом обновлялась только
   * при открытии страницы — то есть кухонный планшет, открытый с утра, вечером
   * записывал обратно свой утренний снимок и молча откатывал всё, что за день
   * поменяли с другого устройства (шаг курса, режим очереди, часы работы).
   *
   * @param next — полный объект настроек с уже применённым изменением
   */
  const handleSettingsChange = useCallback((next: SystemSettings) => {
    const prev = settingsRef.current;

    // Сравнение через JSON: в настройках есть массивы (activePriorityRules,
    // excludedDates, dessertTriggerModifierPatterns), для них === не работает.
    for (const key of Object.keys(next) as (keyof SystemSettings)[]) {
      if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
        (pendingPatchRef.current as Record<string, unknown>)[key as string] = next[key];
      }
    }

    setSettings(next);

    if (settingsSaveTimer.current) {
      clearTimeout(settingsSaveTimer.current);
    }
    settingsSaveTimer.current = setTimeout(async () => {
      const patch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(patch).length === 0) return;

      try {
        await updateSettings(patch);
      } catch (err) {
        console.error('[App] Ошибка сохранения настроек:', err);
        setSettingsError('Не удалось сохранить настройки — проверьте связь с сервером');
        try {
          const fresh = await fetchSettings();
          setSettings(fresh);
        } catch (reloadErr) {
          console.error('[App] Не удалось откатить настройки из БД:', reloadErr);
        }
      }
    }, 500);
  }, []);

  // === Загрузка категорий и настроек из API при монтировании ===
  // Функция перезагрузки блюд из БД — вызывается после изменения алиасов
  const reloadDishes = useCallback(async () => {
    try {
      const dsh = await fetchDishes();
      setDishes(dsh);
    } catch (err) {
      console.error('[App] Ошибка перезагрузки блюд:', err);
    }
  }, []);

  useEffect(() => {
    // Флаг «эффект ещё жив» — защита от setState после размонтирования
    // (StrictMode в dev монтирует эффект дважды).
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadData = async () => {
      try {
        const [cats, sets, dsh] = await Promise.all([
          fetchCategories(),
          fetchSettings(),
          fetchDishes()
        ]);
        if (!alive) return;
        setCategories(cats);
        setSettings(sets);
        setSettingsLoaded(true);
        setDishes(dsh);
      } catch (err) {
        console.error('[App] Ошибка загрузки данных:', err);
        // Кухонный планшет: backend мог ещё не подняться. Повторяем каждые
        // 3 сек, пока не получим настройки — без них экраны не рендерятся
        // (глобальный гейт), очередь не должна строиться по дефолтам.
        if (alive) {
          retryTimer = setTimeout(loadData, 3000);
        }
      }
    };
    loadData();

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // === CUSTOM HOOKS ===
  const {
    ingredients,
    setIngredients,
    ingMap,
    handleAddIngredient,
    handleUpdateIngredient,
    handleRenameParent,
    handleDeleteIngredient,
    reloadIngredients
  } = useIngredients();

  const {
    handleToggleStop,
    handleToggleDishStop
  } = useStopList({
    ingredients,
    setIngredients,
    ingMap,
    dishes,
    setDishes,
    dishMap,
    reloadIngredients,
    reloadDishes,
    user,
  });

  const {
    orders,
    // Флаг первой загрузки заказов — прокидывается в SlicerStation для звука
    // нового заказа: первый снапшот доски запоминается без сигнала.
    loading: ordersLoading,
    orderHistory,
    // Признаки «свежести» доски для плашки «нет связи с сервером»
    lastSyncAt,
    failedPolls,
    // Клейм «В работе» (миграция 029) — общий для всех планшетов
    claimError,
    handleStackMerge,
    handleMergeAck,
    handleClaimOrders,
    handleReleaseOrders,
    handleCompleteOrder,
    handlePartialComplete,
    handleCancelOrder,
    handleRestoreOrder,
    handleParkTable,
    handleUnparkNow,
    handleUnparkOrders,
    handleStartDefrost,
    handleCancelDefrost,
    handleCompleteDefrost
  } = useOrders({
    settings,
    dishes,
    dishMap,
    ingredients,
    // Кем подписывать клейм «В работе» и автора порции в истории (миграция 029)
    currentUser: user
  });

  // === Периодическое обновление справочников ===
  //
  // Заказы опрашиваются каждые 4 секунды, а блюда, категории и ингредиенты
  // раньше грузились ровно один раз — при открытии страницы. Планшет живёт
  // открытым сутками, поэтому «раз при открытии» на практике означало «раз в
  // неделю». Последствия: заведующая назначила категорию новому блюду со своего
  // планшета → заказы на него приезжают, но на планшете нарезчика молча не
  // рисуются (обе точки отрисовки пропускают позицию, если блюда нет в локальном
  // справочнике); поправили рецепт → режут по старому составу, и в отчёт о
  // расходе уходит старый набор; поставили стоп с другого устройства → здесь
  // он не подсветится.
  //
  // Раз в минуту: справочники маленькие (299 блюд, 260 ингредиентов), а реакция
  // достаточно быстрая, чтобы никто не заметил задержки.
  useEffect(() => {
    if (!settingsLoaded) return;

    const refreshCatalogs = async () => {
      try {
        const [cats, dsh] = await Promise.all([fetchCategories(), fetchDishes()]);
        setCategories(cats);
        setDishes(dsh);
      } catch (err) {
        // Сеть моргнула — не страшно, попробуем на следующем круге.
        // Плашку «нет связи» рисует доска по данным поллинга заказов.
        console.warn('[App] Не удалось обновить справочники:', err);
      }
      try {
        await reloadIngredients();
      } catch (err) {
        console.warn('[App] Не удалось обновить ингредиенты:', err);
      }
    };

    const interval = setInterval(refreshCatalogs, 60000);
    return () => clearInterval(interval);
  }, [settingsLoaded, reloadIngredients]);

  // Перечитываем настройки при входе в админку: там их правят, и работать
  // нужно от свежего значения, а не от снимка, снятого при открытии страницы.
  useEffect(() => {
    if (currentView !== 'ADMIN' || !settingsLoaded) return;
    let alive = true;
    fetchSettings()
      .then(fresh => { if (alive) setSettings(fresh); })
      .catch(err => console.warn('[App] Не удалось перечитать настройки:', err));
    return () => { alive = false; };
  }, [currentView, settingsLoaded]);

  // === GATE: не залогинен → экран ввода PIN ===
  // Хук useAuth восстанавливает юзера из localStorage синхронно на init,
  // поэтому F5 не покажет LoginScreen если сессия валидна.
  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  // === GATE: настройки ещё не загрузились из БД ===
  // Ни один экран не рендерится по хардкод-дефолтам: у окна COURSE_FIFO и
  // прочих настроек нет «дефолта», истина — только slicer_settings. При
  // недоступном backend loadData ретраит каждые 3 сек (см. useEffect выше).
  if (!settingsLoaded) {
    return (
      <div className="h-screen w-full bg-kds-bg flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="animate-pulse text-lg font-bold text-white">KDS Slicer Station</div>
        <div className="text-sm">Загрузка настроек из базы данных…</div>
        <div className="text-xs text-slate-600">Если надпись висит долго — проверьте, запущен ли backend (порт 3001)</div>
      </div>
    );
  }

  // === GATE: залогинен, но роль не даёт доступа ни к одной вкладке ===
  // Это Кухня/Хостес/Кассир/без ролей — по требованию заказчика у них
  // нет доступа. Чтобы юзер не был заперт — показываем экран-заглушку
  // с одной только кнопкой «Выйти».
  if (allowedViews.length === 0) {
    return (
      <div className="h-screen w-full bg-kds-bg flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center justify-center bg-red-600/20 p-4 rounded-2xl mb-4 border border-red-900/50">
            <Ban className="text-red-400 w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Нет доступа</h1>
          <p className="text-slate-400 mb-1">
            {user.login}
          </p>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-6">
            {user.roles.join(', ') || 'Без роли'}
          </p>
          <p className="text-slate-400 text-sm mb-8">
            Ваша роль не имеет доступа к модулю нарезки.<br />
            Обратитесь к администратору.
          </p>
          <button
            onClick={logout}
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold uppercase tracking-wider transition-all border border-slate-700"
          >
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      </div>
    );
  }

  // === РЕНДЕРИНГ ОСНОВНОГО МАКЕТА ===
  return (
    <div className="flex flex-col h-screen w-full bg-kds-bg text-white font-sans overflow-hidden">
      <Navigation
        currentView={currentView}
        setView={setCurrentView}
        activeOrderCount={orders.length}
        allowedViews={allowedViews}
        user={user}
        onLogout={logout}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {currentView === 'KDS' && (
          <SlicerStation
            orders={orders}
            dishes={dishes}
            categories={categories}
            ingredients={ingredients}
            onCompleteOrder={handleCompleteOrder}
            onStackMerge={handleStackMerge}
            onMergeAck={handleMergeAck}
            onPreviewImage={setPreviewImage}
            onParkTable={handleParkTable}
            onUnparkTable={handleUnparkNow}
            onUnparkOrders={handleUnparkOrders}
            onCancelOrder={handleCancelOrder}
            onPartialComplete={handlePartialComplete}
            orderHistory={orderHistory}
            onRestoreOrder={handleRestoreOrder}
            settings={settings}
            ordersLoading={ordersLoading}
            lastSyncAt={lastSyncAt}
            failedPolls={failedPolls}
            onStartDefrost={handleStartDefrost}
            onCancelDefrost={handleCancelDefrost}
            onCompleteDefrost={handleCompleteDefrost}
            // Режим нескольких нарезчиков (миграция 029): кто я и как взять/
            // отпустить карточку. Метка «В работе» общая для всех планшетов.
            currentUser={user}
            onClaimOrders={handleClaimOrders}
            onReleaseOrders={handleReleaseOrders}
            claimError={claimError}
          />
        )}
        {currentView === 'STOPLIST' && (
          <StopListManager
            ingredients={ingredients}
            onToggleStop={handleToggleStop}
            onAddIngredient={handleAddIngredient}
            onUpdateIngredient={handleUpdateIngredient}
            onRenameParent={handleRenameParent}
            onDeleteIngredient={handleDeleteIngredient}
            onPreviewImage={setPreviewImage}
          />
        )}
        {/* settingsLoaded здесь проверять не нужно — глобальный гейт выше
            гарантирует, что до загрузки настроек не рендерится ничего. */}
        {/* Ошибка сохранения настроек — раньше уходила только в консоль,
            и заведующая была уверена, что значение сохранилось */}
        {settingsError && currentView === 'ADMIN' && (
          <div className="mx-8 mt-6 px-4 py-3 bg-red-900/40 border border-red-600 rounded flex items-start gap-3">
            <span className="text-red-200 text-sm flex-1">{settingsError}</span>
            <button
              onClick={() => setSettingsError('')}
              className="text-red-300 hover:text-white text-sm font-bold shrink-0"
            >
              Понятно
            </button>
          </div>
        )}
        {currentView === 'ADMIN' && (
          <AdminPanel
            categories={categories}
            dishes={dishes}
            ingredients={ingredients}
            setCategories={setCategories}
            setDishes={setDishes}
            settings={settings}
            setSettings={handleSettingsChange}
            onToggleDishStop={handleToggleDishStop}
            onRefreshDishes={reloadDishes}
          />
        )}
        {currentView === 'DASHBOARD' && (
          <Dashboard
            categories={categories}
            ingredients={ingredients}
            dishes={dishes}
            settings={settings}
            onUpdateIngredient={handleUpdateIngredient}
          />
        )}
      </main>

      {/* === ПОЛНОЭКРАННЫЙ ПРОСМОТР ИЗОБРАЖЕНИЯ === */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="relative w-full h-full flex items-center justify-center p-8">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[80vh] object-contain rounded-lg border border-slate-800 shadow-2xl"
            />
          </div>
          <div className="absolute bottom-10 w-full flex justify-center">
            <button
              onClick={() => setPreviewImage(null)}
              className="bg-green-600 hover:bg-green-500 text-white text-xl font-bold uppercase tracking-widest py-4 px-16 rounded-lg shadow-glow-green transition-all transform hover:scale-105 flex items-center gap-3"
            >
              <Check size={28} strokeWidth={3} />
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
