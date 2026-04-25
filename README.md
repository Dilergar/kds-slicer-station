# KDS Slicer Station

**KDS Slicer Station** — это профессиональная система управления заказами на кухне (Kitchen Display System), разработанная специально для станции нарезки (слайсинга). Модуль подключается к существующей KDS-системе через PostgreSQL.

## Технологический Стек
* **Frontend:** React 19 + TypeScript 5.8 + Vite 6
* **Backend:** Express 4 + pg (node-postgres)
* **БД:** PostgreSQL 18 (база `arclient`)
* **Стили:** TailwindCSS v4 (CDN) + Lucide React (иконки)
* **Графики:** Recharts (Dashboard)

---

## Структура проекта
```text
kds-slicer-station/
├── App.tsx                    # Корневой компонент, роутинг
├── types.ts                   # TypeScript типы
├── services/                  # Frontend API-клиент (fetch обёртки)
│   ├── client.ts              # Базовый fetch wrapper
│   ├── ordersApi.ts           # Заказы (complete, park, unpark, merge)
│   ├── ingredientsApi.ts      # CRUD ингредиентов
│   ├── categoriesApi.ts       # CRUD категорий
│   ├── settingsApi.ts         # Настройки
│   ├── stoplistApi.ts         # Стоп-лист
│   ├── dishesApi.ts           # Загрузка блюд
│   └── recipesApi.ts          # Рецепты
├── hooks/                     # Бизнес-логика (API + state)
│   ├── useOrders.ts           # Polling заказов, все actions через API
│   ├── useIngredients.ts      # CRUD ингредиентов через API
│   └── useStopList.ts         # Стоп-лист через API, каскад
├── components/                # UI компоненты
│   ├── admin/                 # Панель администратора
│   └── dashboard/             # Аналитика и KPI
├── server/                    # Backend (Express + PostgreSQL)
│   ├── src/index.ts           # Express, порт 3001
│   ├── src/routes/            # API маршруты (9 файлов)
│   │   └── stoplist.ts        # включает recalculateCascadeStops helper
│   ├── src/config/db.ts       # pg.Pool подключение к arclient
│   ├── .env.example           # Шаблон конфига backend
│   ├── src/services/          # Адаптеры (kdsStoplistSync — двусторонний стоп-лист)
│   └── migrations/            # SQL миграции (21 файл: 001–021)
├── BD_docs/                   # Документация БД для программистов
│   ├── README.md              # Обзор архитектуры, ER-схема
│   ├── tables/                # Описание каждой slicer_ таблицы (15 файлов)
│   ├── migrations/            # Описание миграций (21 файл)
│   ├── mappings.md            # TypeScript ↔ DB маппинг
│   └── existing_tables.md     # Таблицы основной KDS
└── Инструкция.md              # Гайд по развёртыванию для IT-команды заказчика
```

---

## База данных

### Подключение
- **Host:** localhost (по умолчанию, см. `server/.env`)
- **Port:** 5432
- **Database:** arclient
- **User/Password:** задаются в `server/.env` (см. `server/.env.example`)

### Существующие таблицы KDS (чтение):
- `docm2_orders` — заказы
- `docm2tabl1_items` — позиции заказов
- `ctlg15_dishes` — блюда
- `ctlg13_halltables` — столы

### Таблицы модуля нарезчика (prefix `slicer_`, всего 15):
| Таблица | Назначение |
|---|---|
| `slicer_categories` | Категории с порядком сортировки |
| `slicer_dish_categories` | Ручное назначение slicer-категорий блюдам |
| `slicer_ingredients` | Справочник ингредиентов (иерархия, стоп-лист) |
| `slicer_recipes` | Рецепты: блюдо → ингредиент + граммовка |
| `slicer_dish_aliases` | Алиасы блюд: общий рецепт для вариантов (163/Д163) |
| `slicer_dish_stoplist` | Актуальный стоп-лист блюд (MANUAL + CASCADE) |
| `slicer_dish_images` | Фото блюд: путь до файла в `server/public/images/dishes/` |
| `slicer_dish_priority` | Приоритет блюда (1=NORMAL, 3=ULTRA), per-dish |
| `slicer_dish_defrost` | Per-dish флаг «требует разморозки?» + время таймера |
| `slicer_kds_sync_config` | Конфиг двусторонней синхронизации с rgst3_dishstoplist (OFF по умолчанию) |
| `slicer_order_state` | Состояние заказов нарезчика (парковка, статус, finished_at, defrost) |
| `slicer_order_history` | Завершённые заказы (KPI) |
| `slicer_ingredient_consumption` | Расход ингредиентов |
| `slicer_stop_history` | История стоп-листа |
| `slicer_settings` | Настройки модуля (singleton) |

Подробная документация: `BD_docs/tables/`

---

## Ключевые фичи

### Smart Wave Aggregation
Группирует одинаковые блюда по "волнам выноса" для минимизации нагрузки на нарезчика.

### Парковка столов (Table Parking)
Откладывание заказов с таймером автовозврата. Поддерживает split: часть заказа ACTIVE, часть PARKED.

### Dashboard KPI
- Средняя скорость приготовления (обычные vs паркованные)
- Расход ингредиентов с буфером
- % времени на стопе (с учётом рабочих часов и выходных)

---

## Запуск проекта

### 1. Установить зависимости
```bash
npm install
cd server && npm install
```

### 2. Настроить `.env`
```bash
cp server/.env.example server/.env
# Отредактировать server/.env — укажите пароль PostgreSQL и (если нужно) другое имя БД
```

### 3. Развернуть таблицы модуля в существующую БД `arclient`
```bash
# Создать все 10 slicer-таблиц + начальные данные (категории, настройки):
cd server && npm run migrate
```
Либо вручную по порядку:
```bash
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/001_create_slicer_tables.sql
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/002_seed_defaults.sql
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/003_dish_aliases.sql
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/004_dish_categories.sql
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/005_dish_stoplist.sql
psql -U postgres -d arclient -v ON_ERROR_STOP=1 -f server/migrations/006_kds_stoplist_sync.sql
```

> **Внимание:** перед первым запуском на новом ресторане обновите константу
> `KITCHEN_STORAGE_UUIDS` в `server/src/routes/orders.ts` и `dishes.ts` под
> UUID цеха «Кухня» вашей `ctlg17_storages`. Подробнее — в [`Инструкция.md`](Инструкция.md).

### 4. Запустить backend (порт 3001)
```bash
cd server && npm run dev
```

### 5. Запустить frontend (порт 3000)
```bash
npm run dev
```

### 6. Открыть в браузере
```
http://localhost:3000
```

> **Для передачи модуля IT-команде заказчика:** см. подробный гайд
> [`Инструкция.md`](Инструкция.md) в корне проекта.

---

## Команды
```bash
# Frontend
npm install       # Установка зависимостей
npm run dev       # Dev-сервер (порт 3000)
npm run build     # Production сборка
npm run typecheck # Проверка типов (tsc --noEmit)
npm run lint      # Линтинг (ESLint)

# Backend
cd server
npm install       # Установка зависимостей сервера
npm run dev       # Dev-сервер (порт 3001, hot-reload)
npm run build     # Компиляция TypeScript
npm start         # Production запуск
```

---

## API Endpoints

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/orders` | Активные заказы (polling каждые 4 сек) |
| POST | `/api/orders/:id/complete` | Завершить заказ |
| POST | `/api/orders/:id/partial-complete` | Частичное завершение |
| POST | `/api/orders/:id/restore` | Вернуть из истории (UPSERT slicer_order_state = ACTIVE) |
| POST | `/api/orders/:id/park` | Парковка стола |
| POST | `/api/orders/:id/unpark` | Снять с парковки |
| POST | `/api/orders/:id/merge` | Объединить стеки |
| POST | `/api/orders/:id/cancel` | Отменить заказ |
| GET | `/api/dishes` | Справочник блюд кухни (с whitelist по `KITCHEN_STORAGE_UUIDS`) |
| POST | `/api/dishes/:id/image` | Загрузить фото блюда (multipart/form-data, поле `image`, ≤5МБ) |
| DELETE | `/api/dishes/:id/image` | Удалить фото блюда (файл + запись в БД) |
| POST | `/api/ingredients/:id/image` | Загрузить фото ингредиента (multipart, ≤5МБ) |
| DELETE | `/api/ingredients/:id/image` | Удалить фото ингредиента (файл + image_url) |
| PUT | `/api/dishes/:dishId/categories` | Назначить блюду slicer-категории (полная замена) |
| GET | `/api/dish-aliases` | Список алиасов блюд |
| POST | `/api/dish-aliases` | Создать алиас (автокопия категорий primary → alias) |
| DELETE | `/api/dish-aliases/:alias_dish_id` | Отвязать алиас |
| GET | `/api/ingredients` | Список ингредиентов (+ POST/PUT/DELETE) |
| GET | `/api/categories` | Список категорий (+ POST/PUT/DELETE) |
| PUT | `/api/categories/reorder` | Пакетная смена порядка |
| GET | `/api/settings` | Настройки модуля |
| PUT | `/api/settings` | Обновить настройки |
| POST | `/api/stoplist/toggle` | Переключить стоп-лист |
| GET | `/api/stoplist/history` | История стопов |
| GET | `/api/history/orders` | История заказов |
| GET | `/api/history/dashboard/speed-kpi` | KPI скорости приготовления (нарезчик) |
| GET | `/api/history/dashboard/chef-cooking-speed` | Скорость готовки повара (cooktime − finished_at) |
| GET | `/api/history/dashboard/ingredient-usage` | Расход ингредиентов |
| GET | `/api/recipes/:dishId` | Рецепт блюда (+ PUT для обновления) |
| GET | `/api/health` | Проверка здоровья сервера |

Полный список: см. `server/src/routes/`
