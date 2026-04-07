# CLAUDE.md — Контекст проекта для AI-агента

## ⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА (ВСЕГДА СОБЛЮДАТЬ)

### 1. Комментарии к коду — ТОЛЬКО на русском языке
- **Каждая функция** должна иметь JSDoc-комментарий на русском, описывающий что она делает, входные параметры и возвращаемое значение.
- **Каждый новый блок логики** (особенно при добавлении нового функционала) — обязательно с подробными inline-комментариями на русском.
- Комментарии должны объяснять **зачем** код делает то, что делает, а не просто **что** он делает.
- Пример:
  ```tsx
  /**
   * Обработчик завершения заказа — рассчитывает потреблённые ингредиенты,
   * записывает в историю и удаляет из активных заказов
   */
  const handleCompleteOrder = (orderId: string) => { ... }
  ```

### 2. Актуальность документации — обновлять ПОСЛЕ КАЖДОГО изменения
- **После каждого изменения кода** необходимо проверить и обновить:
  - `CLAUDE.md` — если изменилась архитектура, добавились новые файлы/компоненты/типы/паттерны
  - `README.md` — если изменились зависимости, структура проекта, функциональность или инструкции
- Это **не опционально** — документация должна быть **всегда актуальной**.
- Порядок работы: (1) Сделать изменения в коде → (2) Проверить что нужно обновить в документации → (3) Обновить `CLAUDE.md` и `README.md`.

---

## Название проекта
**KDS Slicer Station** — Kitchen Display System для станции нарезки

## Технологии
- **Frontend:** React 19 + TypeScript 5.8 + Vite 6
- **Стили:** TailwindCSS (CDN, конфиг в `index.html`)
- **Иконки:** lucide-react
- **Графики:** recharts
- **Backend:** Отсутствует (все данные в React state)

## Структура файлов

```
/                           # Корень проекта
├── index.html              # HTML-шаблон, TailwindCSS CDN конфиг
├── index.tsx               # React entry point (ReactDOM.createRoot)
├── App.tsx                 # Корневой компонент: ВСЯ бизнес-логика и state
├── types.ts                # TypeScript типы: Order, Dish, Ingredient, Settings...
├── utils.ts                # Утилиты: generateId(), calculateConsumedIngredients()
├── constants.ts            # Начальные данные: INITIAL_ORDERS, INITIAL_DISHES, PIN_CODE
├── vite.config.ts          # Vite: порт 3000, host 0.0.0.0, alias @
├── tsconfig.json           # TS config: ES2022, react-jsx, bundler
├── .env.local              # ENV: GEMINI_API_KEY (placeholder)
├── eslint.config.js        # ESLint flat config (TS + React)
├── .gitignore              # Git: node_modules, dist, .env*, логи
├── components/
│   ├── Navigation.tsx      # Навигация: 4 вкладки (Board, Products, Admin, Reports) + Test
│   ├── SlicerStation.tsx   # KDS Board: сортировка, парковка, история, partial complete
│   ├── OrderCard.tsx       # Карточка заказа: таймер, ингредиенты, scroll-to-accept
│   ├── StopListManager.tsx # Стоп-лист: иерархия ингредиентов, PIN-авторизация, CRUD
│   ├── StopReasonModal.tsx # Модалка причины стопа (Out of Stock, Spoilage, etc.)
│   ├── PartialCompletionModal.tsx # Numpad для частичного выполнения заказа
│   ├── AdminPanel.tsx      # Админ: категории, рецепты, настройки, стоп-настройки
│   └── Dashboard.tsx       # Аналитика: история стопов, скорость, расход ингред.
└── public/images/          # Статические изображения
```

## Архитектура

### Управление состоянием
- **Централизованный state** в `App.tsx` (useState для каждого домена)
- **Нет Redux/Zustand** — простой prop drilling
- **Основные state-переменные:**
  - `orders: Order[]` — активные заказы
  - `dishes: Dish[]` — справочник блюд
  - `categories: Category[]` — категории меню
  - `ingredients: IngredientBase[]` — справочник ингредиентов
  - `settings: SystemSettings` — системные настройки
  - `stopHistory: StopHistoryEntry[]` — история стопов
  - `orderHistory: OrderHistoryEntry[]` — история выполненных заказов

### Ключевые паттерны

1. **Smart Stacking (Умное объединение заказов)**
   - `quantity_stack: number[]` + `table_stack: number[][]`
   - Незмерженные стеки: `[2, 1]` → нужно нажать Merge до Done
   - Змерженные: `[3]` → можно нажать Done
   - Агрегация по: (1) тому же столу, (2) временному окну

2. **Иерархия ингредиентов**
   - Двухуровневая: Parent (Potatoes) → Children (Raw Potato, Mashed...)
   - `parentId` поле в `IngredientBase`
   - Стоп родителя каскадирует на все children
   - Auto-sync: если ингредиент на стопе → блюдо автоматически на стопе (`useEffect` в `App.tsx`)

3. **Парковка столов**
   - Table parking = откладывание заказов с таймером возврата
   - Может разделять (split) заказ: одна часть ACTIVE, другая PARKED
   - Auto-unpark через `setInterval` каждые 10 секунд
   - `parked_tables: number[]` — гранулярный трекинг каких столов паркованы

4. **Scroll-to-Accept (OrderCard)**
   - Если >5 ингредиентов → кнопка Done заблокирована
   - Разблокируется только при прокрутке до конца списка
   - Предотвращает случайное завершение без просмотра всех компонентов

5. **COURSE_FIFO (Гибридная сортировка)**
   - Заказы группируются по временным окнам (`courseWindowSeconds`, дефолт: 300с = 5мин)
   - Внутри окна — по категории (суп → салат → горячее → десерт)
   - Между окнами — строго FIFO (новые заказы не обгоняют старые)
   - `SortRuleType: 'ULTRA' | 'FIFO' | 'CATEGORY' | 'COURSE_FIFO'`
   - Default: `activePriorityRules: ['ULTRA', 'COURSE_FIFO']`

## Навигация (ViewMode)
| Mode | Компонент | Описание |
|---|---|---|
| `KDS` | `SlicerStation` | Основная доска заказов |
| `STOPLIST` | `StopListManager` | Управление стоп-листом |
| `ADMIN` | `AdminPanel` | Администрирование |
| `DASHBOARD` | `Dashboard` | Отчёты и аналитика |

## Важные константы
- **PIN-код** редактора: `01151995` (файл `constants.ts`, переменная `PIN_CODE`)
- **Порт** dev-сервера: `3000` (файл `vite.config.ts`)
- **Окно агрегации** по умолчанию: `5 минут`
- **Окно COURSE_FIFO** по умолчанию: `300 секунд` (5 мин)
- **Удержание истории** по умолчанию: `60 минут`

## Стилизация
- **TailwindCSS через CDN** (глобальный `tailwind.config` в `<script>` тэге `index.html`)
- **Кастомные цвета:** `kds-bg`, `kds-card`, `kds-header`, `kds-accent`, `kds-ultra`, `kds-vip`, `kds-success`
- **Кастомные тени:** `glow-red`, `glow-orange`, `glow-green`
- **Тёмная тема** только (нет переключателя)

## Команды
```bash
npm install       # Установка зависимостей
npm run dev       # Dev-сервер (порт 3000)
npm run build     # Production сборка
npm run preview   # Предпросмотр production сборки
npm run typecheck # Проверка типов (tsc --noEmit)
npm run lint      # Линтинг (ESLint)
```

## Важные Notes для AI

1. **Нет бэкенда** — при добавлении persistence необходимо создать API
2. **Тесты отсутствуют** — нет тестового фреймворка
3. **Изображения:** часть через Unsplash URL, часть через локальные `/images/`, часть Base64
4. **Strict Mode включён** — компоненты рендерятся дважды в dev, побочные эффекты написаны с учётом этого
5. **Все handler-функции** определены в `App.tsx` и передаются через props (не через context)
6. **Functional Setter Pattern** — `handleCompleteOrder`, `handlePartialComplete`, `handleAddTestOrder` читают текущее состояние `orders` через `prev` внутри `setOrders(prev => ...)` для предотвращения stale closures в React 19
7. **ESLint** — используется flat config (`eslint.config.js`) с TS-парсером
