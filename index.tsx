/**
 * index.tsx — Точка входа React-приложения
 *
 * Находит DOM-элемент #root в index.html и монтирует в него App-компонент.
 * React.StrictMode включён для обнаружения потенциальных проблем в разработке.
 * ErrorBoundary оборачивает App для отлова runtime-ошибок.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Получаем корневой DOM-элемент для монтирования React-приложения
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

// Создаём React root и рендерим приложение в режиме StrictMode
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
