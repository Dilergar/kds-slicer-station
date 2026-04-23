/**
 * Navigation.tsx — Верхняя навигационная панель
 *
 * Отображает логотип, кнопки переключения разделов, кнопку Test Order,
 * имя залогиненного пользователя и кнопку «Выйти».
 *
 * Вкладки фильтруются по allowedViews (вычисляется в App по роли юзера из
 * ROLE_ACCESS). Скрытые вкладки не рендерятся вообще — если у юзера нет
 * прав на Настройки, он их даже не видит в шапке.
 */

import React from 'react';
import { ViewMode, AuthUser } from '../types';
import { LayoutGrid, ShoppingBasket, FileText, Settings, Zap, LayoutDashboard, LogOut } from 'lucide-react';

interface NavigationProps {
  currentView: ViewMode;
  setView: (view: ViewMode) => void;
  activeOrderCount: number;
  onAddTestOrder?: () => void;
  allowedViews: ViewMode[];
  user: AuthUser | null;
  onLogout: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentView,
  setView,
  activeOrderCount,
  onAddTestOrder,
  allowedViews,
  user,
  onLogout,
}) => {
  // Конфиг всех вкладок в одном месте — ниже фильтруем по allowedViews, чтобы
  // не плодить условные рендеры под каждую кнопку
  const allTabs: { view: ViewMode; icon: React.ElementType; label: string; count?: number }[] = [
    { view: 'KDS', icon: LayoutGrid, label: 'Очередь', count: activeOrderCount },
    { view: 'STOPLIST', icon: ShoppingBasket, label: 'Сырье' },
    { view: 'ADMIN', icon: Settings, label: 'Настройки' },
    { view: 'DASHBOARD', icon: FileText, label: 'Отчеты' },
  ];

  const visibleTabs = allTabs.filter(t => allowedViews.includes(t.view));

  return (
    <header className="flex justify-between items-center px-4 py-2 bg-kds-header border-b border-kds-border shadow-md z-50 sticky top-0 shrink-0">
      <div className="flex items-center gap-3">
        <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-900/20 shrink-0">
          <LayoutDashboard className="text-white w-5 h-5" />
        </div>
        <h1 className="text-base md:text-lg font-extrabold text-white tracking-widest uppercase font-sans whitespace-nowrap">Экран Нарезки (KDS)</h1>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar mask-gradient-right">
        <div className="flex items-center gap-1 md:gap-2">
          {visibleTabs.map(tab => (
            <NavButton
              key={tab.view}
              active={currentView === tab.view}
              onClick={() => setView(tab.view)}
              icon={tab.icon}
              label={tab.label}
              count={tab.count}
            />
          ))}
        </div>

        {(onAddTestOrder || user) && (
          <div className="h-6 w-px bg-slate-800 shrink-0 hidden md:block"></div>
        )}

        {onAddTestOrder && allowedViews.includes('KDS') && (
          <button
            onClick={onAddTestOrder}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-yellow-500 hover:text-yellow-400 hover:bg-slate-700 rounded-md text-xs font-bold uppercase tracking-wider transition-all border border-slate-700 whitespace-nowrap"
          >
            <Zap size={14} className="fill-current" />
            Тест
          </button>
        )}

        {user && (
          <div className="flex items-center gap-2 pl-2">
            <div className="hidden md:flex flex-col items-end leading-tight">
              <span className="text-sm font-bold text-white whitespace-nowrap max-w-[180px] truncate">{user.login}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider whitespace-nowrap">
                {user.roles.join(', ') || 'Без роли'}
              </span>
            </div>
            <button
              onClick={onLogout}
              title="Выйти"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-300 hover:text-red-400 hover:bg-slate-700 rounded-md text-xs font-bold uppercase tracking-wider transition-all border border-slate-700 whitespace-nowrap"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>
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
