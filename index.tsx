/**
 * index.tsx — Точка входа React-приложения
 *
 * Находит DOM-элемент #root в index.html и монтирует в него App-компонент.
 * React.StrictMode включён для обнаружения потенциальных проблем в разработке.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

// Получаем корневой DOM-элемент для монтирования React-приложения
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

// Создаём React root и рендерим приложение в режиме StrictMode.
// ErrorBoundary снаружи App: если рендер упадёт, нарезчик увидит экран с кнопкой
// «Перезагрузить», а не пустую белую страницу без единого элемента управления.
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
