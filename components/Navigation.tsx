/**
 * Navigation.tsx — Верхняя навигационная панель
 *
 * Отображает логотип, кнопки переключения разделов (Board, Products, Admin, Reports),
 * кнопку "Test Order" для симуляции заказов, бейджи активных заказов и паркованных столов.
 */

import React from 'react';
import { ViewMode } from '../types';
import { LayoutGrid, ShoppingBasket, FileText, Settings, Zap, LayoutDashboard } from 'lucide-react';

interface NavigationProps {
  currentView: ViewMode;
  setView: (view: ViewMode) => void;
  activeOrderCount: number;
  onAddTestOrder?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentView, setView, activeOrderCount, onAddTestOrder }) => {
  return (
    <header className="flex justify-between items-center px-4 py-2 bg-kds-header border-b border-kds-border shadow-md z-50 sticky top-0 shrink-0">
      <div className="flex items-center gap-3">
        <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-900/20 shrink-0">
          <LayoutDashboard className="text-white w-5 h-5" />
        </div>
        <h1 className="text-base md:text-lg font-extrabold text-white tracking-widest uppercase font-sans whitespace-nowrap">KDS Cutting Station</h1>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar mask-gradient-right">
        <div className="flex items-center gap-1 md:gap-2">
          <NavButton
            active={currentView === 'KDS'}
            onClick={() => setView('KDS')}
            icon={LayoutGrid}
            label="Board"
            count={activeOrderCount}
          />
          <NavButton
            active={currentView === 'STOPLIST'}
            onClick={() => setView('STOPLIST')}
            icon={ShoppingBasket}
            label="Products"
          />
          <NavButton
            active={currentView === 'ADMIN'}
            onClick={() => setView('ADMIN')}
            icon={Settings}
            label="Admin"
          />
          <NavButton
            active={currentView === 'DASHBOARD'}
            onClick={() => setView('DASHBOARD')}
            icon={FileText}
            label="Reports"
          />
        </div>

        <div className="h-6 w-px bg-slate-800 shrink-0 hidden md:block"></div>

        {onAddTestOrder && (
          <button
            onClick={onAddTestOrder}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-yellow-500 hover:text-yellow-400 hover:bg-slate-700 rounded-md text-xs font-bold uppercase tracking-wider transition-all border border-slate-700 whitespace-nowrap"
          >
            <Zap size={14} className="fill-current" />
            Test
          </button>
        )}
      </div>
    </header>
  );
};

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count?: number;
}

const NavButton: React.FC<NavButtonProps> = ({ active, onClick, icon: Icon, label, count }) => (
  <button
    onClick={onClick}
    className={`
      flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-200 shrink-0
      ${active
        ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-700'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}
    `}
  >
    <Icon size={16} />
    <span className="text-sm font-medium whitespace-nowrap hidden sm:inline-block">{label}</span>
    {count !== undefined && count > 0 && (
      <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
        {count}
      </span>
    )}
  </button>
);