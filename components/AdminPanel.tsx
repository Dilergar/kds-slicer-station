/**
 * AdminPanel.tsx — Административная панель управления системой
 *
 * Вкладки:
 * - Menu Categories: CRUD категорий меню с drag-сортировкой приоритетов
 * - Recipe Editor: создание/редактирование блюд, привязка ингредиентов, загрузка фото
 * - Category Ranking: управление порядком приоритета категорий на KDS-доске
 * - System Settings: системные настройки
 */

import React, { useState } from 'react';
import { Category, Dish, IngredientBase, SystemSettings } from '../types';
import { StopReasonModal } from './StopReasonModal';
import { CategoriesTab } from './admin/CategoriesTab';
import { RecipeEditor } from './admin/RecipeEditor';
import { CategoryRanking } from './admin/CategoryRanking';
import { SystemSettingsTab } from './admin/SystemSettingsTab';

interface AdminPanelProps {
  categories: Category[];
  dishes: Dish[];
  ingredients: IngredientBase[];
  setCategories: (cats: Category[]) => void;
  setDishes: (dishes: Dish[]) => void;
  settings: SystemSettings;
  setSettings: (settings: SystemSettings) => void;
  /** Возвращает текст ошибки для показа пользователю либо null при успехе */
  onToggleDishStop: (dishId: string, reason?: string) => Promise<string | null>;
  onRefreshDishes?: () => Promise<void> | void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  categories,
  dishes,
  ingredients,
  setCategories,
  setDishes,
  settings,
  setSettings,
  onToggleDishStop,
  onRefreshDishes
}) => {
  const [activeTab, setActiveTab] = useState<'CATEGORIES' | 'RECIPES' | 'RANKING' | 'SETTINGS'>('CATEGORIES');

  // Stop Logic State (kept global for AdminPanel modal)
  const [stopModalId, setStopModalId] = useState<string | null>(null);

  // Ошибка переключения стоп-листа. Нужна прежде всего для попытки снять
  // каскадный стоп: backend отвечает 409 и подсказывает, что снимать надо
  // стоп с ингредиента. Раньше тумблер молча возвращался в красное, а в отчёт
  // при этом падала фиктивная запись о снятии.
  const [stopError, setStopError] = useState('');

  const handleStopClick = async (e: React.MouseEvent, dish: Dish) => {
    e.stopPropagation();
    setStopError('');
    if (dish.is_stopped) {
      // Resume immediately
      const err = await onToggleDishStop(dish.id);
      if (err) setStopError(err);
    } else {
      // Open modal to stop
      setStopModalId(dish.id);
    }
  };

  return (
    <div className="flex-1 bg-kds-bg p-8 overflow-y-auto">
      <h1 className="text-3xl font-bold text-white mb-6">Системные Настройки</h1>

      {stopError && (
        <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-600 rounded flex items-start gap-3">
          <span className="text-red-200 text-sm flex-1">{stopError}</span>
          <button
            onClick={() => setStopError('')}
            className="text-red-300 hover:text-white text-sm font-bold shrink-0"
          >
            Понятно
          </button>
        </div>
      )}

      <div className="flex space-x-4 mb-8 border-b border-gray-700 overflow-x-auto shrink-0">
        <button
          onClick={() => setActiveTab('CATEGORIES')}
          className={`pb-3 px-4 font-medium transition-colors whitespace-nowrap ${activeTab === 'CATEGORIES' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Категории Меню
        </button>
        <button
          onClick={() => setActiveTab('RECIPES')}
          className={`pb-3 px-4 font-medium transition-colors whitespace-nowrap ${activeTab === 'RECIPES' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Рецепты
        </button>
        <button
          onClick={() => setActiveTab('RANKING')}
          className={`pb-3 px-4 font-medium transition-colors whitespace-nowrap ${activeTab === 'RANKING' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Приоритет Категорий
        </button>
        <button
          onClick={() => setActiveTab('SETTINGS')}
          className={`pb-3 px-4 font-medium transition-colors whitespace-nowrap ${activeTab === 'SETTINGS' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Общие Настройки
        </button>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        {activeTab === 'CATEGORIES' && (
          <CategoriesTab categories={categories} setCategories={setCategories} settings={settings} setSettings={setSettings} />
        )}

        {activeTab === 'RECIPES' && (
          <RecipeEditor
            categories={categories}
            dishes={dishes}
            setDishes={setDishes}
            ingredients={ingredients}
            handleStopClick={handleStopClick}
            onRefreshDishes={onRefreshDishes}
          />
        )}

        {activeTab === 'RANKING' && (
          <CategoryRanking settings={settings} setSettings={setSettings} />
        )}

        {activeTab === 'SETTINGS' && (
          <SystemSettingsTab settings={settings} setSettings={setSettings} />
        )}
      </div>

      {/* -------------------- STOP REASON MODAL -------------------- */}
      <StopReasonModal
        isOpen={!!stopModalId}
        itemName={dishes.find(i => i.id === stopModalId)?.name || ''}
        onClose={() => setStopModalId(null)}
        onConfirm={async (reason) => {
          if (stopModalId) {
            const id = stopModalId;
            setStopModalId(null);
            const err = await onToggleDishStop(id, reason);
            if (err) setStopError(err);
          }
        }}
      />
    </div>
  );
};
