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
import { TestOrderModal } from './components/TestOrderModal';
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

function App() {
  // === Авторизация — PIN из чужой таблицы `users` (см. hooks/useAuth.ts) ===
  const { user, login, logout } = useAuth();

  // Список разрешённых вкладок для залогиненного юзера.
  // Считается даже когда user=null (даст []), чтобы не ломать мемо-цепочку,
  // но фактически не используется до входа — LoginScreen рендерится раньше.
  const allowedViews = useMemo(
    () => (user ? getAllowedViews(user.roles) : []),
    [user]
  );

  // === Текущий режим отображения (KDS | STOPLIST | ADMIN | DASHBOARD) ===
  const [currentView, setCurrentView] = useState<ViewMode>('KDS');
  const [showTestModal, setShowTestModal] = useState(false);
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

  // Флаг: настройки реально подтянулись из БД. Нужен чтобы не флэшить
  // захардкоженные дефолты в UI, пока идёт fetchSettings().
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // === Системные настройки (загружаются из slicer_settings) ===
  const [settings, setSettings] = useState<SystemSettings>({
    aggregationWindowMinutes: 5,
    historyRetentionMinutes: 15,
    activePriorityRules: ['ULTRA', 'COURSE_FIFO'],
    courseWindowSeconds: 10,
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

  /**
   * Обёртка над setSettings: мгновенно обновляет локальный стейт (оптимистично)
   * и с дебаунсом 500 мс отправляет PUT /api/settings для персиста в БД.
   * При ошибке сети откатывает стейт на свежее значение из БД через fetchSettings.
   */
  const handleSettingsChange = useCallback((next: SystemSettings) => {
    setSettings(next);

    if (settingsSaveTimer.current) {
      clearTimeout(settingsSaveTimer.current);
    }
    settingsSaveTimer.current = setTimeout(async () => {
      try {
        await updateSettings(next);
      } catch (err) {
        console.error('[App] Ошибка сохранения настроек:', err);
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
    const loadData = async () => {
      try {
        const [cats, sets, dsh] = await Promise.all([
          fetchCategories(),
          fetchSettings(),
          fetchDishes()
        ]);
        setCategories(cats);
        setSettings(sets);
        setSettingsLoaded(true);
        setDishes(dsh);
      } catch (err) {
        console.error('[App] Ошибка загрузки данных:', err);
      }
    };
    loadData();
  }, []);

  // === CUSTOM HOOKS ===
  const {
    ingredients,
    setIngredients,
    ingMap,
    handleAddIngredient,
    handleUpdateIngredient,
    handleDeleteIngredient,
    reloadIngredients
  } = useIngredients();

  const {
    stopHistory,
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
    orderHistory,
    handleAddTestOrder,
    handleStackMerge,
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
    setDishes,
    dishMap,
    ingredients
  });

  // === GATE: не залогинен → экран ввода PIN ===
  // Хук useAuth восстанавливает юзера из localStorage синхронно на init,
  // поэтому F5 не покажет LoginScreen если сессия валидна.
  if (!user) {
    return <LoginScreen onLogin={login} />;
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
        onAddTestOrder={() => setShowTestModal(true)}
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
            onAddTestOrder={handleAddTestOrder}
            onPreviewImage={setPreviewImage}
            onParkTable={handleParkTable}
            onUnparkTable={handleUnparkNow}
            onUnparkOrders={handleUnparkOrders}
            onCancelOrder={handleCancelOrder}
            onPartialComplete={handlePartialComplete}
            orderHistory={orderHistory}
            onRestoreOrder={handleRestoreOrder}
            settings={settings}
            onStartDefrost={handleStartDefrost}
            onCancelDefrost={handleCancelDefrost}
            onCompleteDefrost={handleCompleteDefrost}
          />
        )}
        {currentView === 'STOPLIST' && (
          <StopListManager
            ingredients={ingredients}
            onToggleStop={handleToggleStop}
            onAddIngredient={handleAddIngredient}
            onUpdateIngredient={handleUpdateIngredient}
            onDeleteIngredient={handleDeleteIngredient}
            onPreviewImage={setPreviewImage}
          />
        )}
        {currentView === 'ADMIN' && settingsLoaded && (
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
        {currentView === 'ADMIN' && !settingsLoaded && (
          <div className="p-8 text-gray-400">Загрузка настроек…</div>
        )}
        {currentView === 'DASHBOARD' && settingsLoaded && (
          <Dashboard
            categories={categories}
            ingredients={ingredients}
            dishes={dishes}
            orderHistory={orderHistory}
            settings={settings}
            onUpdateIngredient={handleUpdateIngredient}
          />
        )}
      </main>

      {/* === МОДАЛЬНОЕ ОКНО ТЕСТОВОГО ЗАКАЗА === */}
      {showTestModal && (
        <TestOrderModal
          dishes={dishes}
          onClose={() => setShowTestModal(false)}
          onAddOrder={(items, tableNumber) => {
            const targetTableNumber = tableNumber !== undefined ? tableNumber : (Math.floor(Math.random() * 100) + 1);
            items.forEach(item => {
              handleAddTestOrder(item.dishId, item.priority, targetTableNumber, item.quantity);
            });
            setShowTestModal(false);
          }}
        />
      )}

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
