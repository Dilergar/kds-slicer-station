/**
 * App.tsx — Корневой компонент приложения KDS Slicer Station
 *
 * Здесь сосредоточен роутинг вьюшек и подключение кастомных хуков.
 * Сама бизнес-логика вынесена в /hooks:
 * - useIngredients: CRUD ингредиентов
 * - useStopList: Управление стоп-листами и авто-стоп блюд
 * - useOrders: Заказы, объединение(stack), парковка столов, история
 * 
 * ВАЖНО ДЛЯ БУДУЩЕЙ РЕАЛИЗАЦИИ БД (PostgreSQL):
 * Этот компонент не должен делать запросы сам. Настройте fetch-логику
 * внутри соответствующих хуков, а сюда возвращайте только готовые стейты (orders, dishes и т.д.).
 */

import React, { useState, useMemo } from 'react';
import { INITIAL_DISHES, INITIAL_CATEGORIES, INITIAL_INGREDIENTS } from './constants';
import { ViewMode, Dish, Category, SystemSettings } from './types';
import { Navigation } from './components/Navigation';
import { SlicerStation } from './components/SlicerStation';
import { StopListManager } from './components/StopListManager';
import { AdminPanel } from './components/AdminPanel';
import { Dashboard } from './components/Dashboard';
import { TestOrderModal } from './components/TestOrderModal';
import { Check } from 'lucide-react';

import { useIngredients } from './hooks/useIngredients';
import { useStopList } from './hooks/useStopList';
import { useOrders } from './hooks/useOrders';

function App() {
  // === Текущий режим отображения (KDS | STOPLIST | ADMIN | DASHBOARD) ===
  const [currentView, setCurrentView] = useState<ViewMode>('KDS');
  const [showTestModal, setShowTestModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // === Основные данные, которые не требуют сложных слоев ===
  const [dishes, setDishes] = useState<Dish[]>(INITIAL_DISHES);
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  const dishMap = useMemo(() => new Map(dishes.map(d => [d.id, d])), [dishes]);

  // === Системные настройки ===
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

  // Демо-данные истории стоп-листа
  const demoStopHistory = useMemo(() => [
    {
      id: 'hist_demo_1',
      ingredientName: 'Potatoes',
      stoppedAt: Date.now() - 1000 * 60 * 60,
      resumedAt: Date.now() - 1000 * 60 * 45,
      reason: 'Delivery Delay',
      durationMs: 1000 * 60 * 15
    },
    {
      id: 'hist_demo_2',
      ingredientName: 'Beef Tenderloin',
      stoppedAt: Date.now() - 1000 * 60 * 120,
      resumedAt: Date.now() - 1000 * 60 * 115,
      reason: 'Quality Issue',
      durationMs: 1000 * 60 * 5
    }
  ], []);

  // === CUSTOM HOOKS ===
  const {
    ingredients,
    setIngredients,
    ingMap,
    handleAddIngredient,
    handleUpdateIngredient,
    handleDeleteIngredient
  } = useIngredients(INITIAL_INGREDIENTS);

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
    initialHistory: demoStopHistory
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
    handleUnparkOrders
  } = useOrders({
    settings,
    dishes,
    setDishes,
    dishMap,
    ingredients
  });

  // === РЕНДЕРИНГ ОСНОВНОГО МАКЕТА ===
  return (
    <div className="flex flex-col h-screen w-full bg-kds-bg text-white font-sans overflow-hidden">
      <Navigation
        currentView={currentView}
        setView={setCurrentView}
        activeOrderCount={orders.length}
        onAddTestOrder={() => setShowTestModal(true)}
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
        {currentView === 'ADMIN' && (
          <AdminPanel
            categories={categories}
            dishes={dishes}
            ingredients={ingredients}
            setCategories={setCategories}
            setDishes={setDishes}
            settings={settings}
            setSettings={setSettings}
            onToggleDishStop={handleToggleDishStop}
          />
        )}
        {currentView === 'DASHBOARD' && (
          <Dashboard
            categories={categories}
            ingredients={ingredients}
            dishes={dishes}
            stopHistory={stopHistory}
            orderHistory={orderHistory}
            settings={settings}
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