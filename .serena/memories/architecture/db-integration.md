# Интеграция с PostgreSQL (arclient)

## Обзор
Модуль Slicer Station подключен к существующей KDS-базе `arclient` (PostgreSQL 18, localhost:5432, postgres/1234). Backend — Express на порту 3001, фронтенд проксирует `/api` через Vite.

## Архитектура слоёв

```
Frontend (React, port 3000)
  ↓ fetch /api/*
Vite proxy
  ↓
Backend (Express, port 3001)
  ↓ pg.Pool
PostgreSQL arclient
  ├── Существующие таблицы KDS (docm2_*, ctlg*, rgst*) — только READ (писали cooked до миграции 007, теперь НЕТ)
  └── 12 таблиц slicer_* — полный CRUD
```

## Ключевые решения

### 1. Папка `services/`, не `api/`
Frontend API-клиент лежит в `services/`, не `api/`. Причина: Vite proxy перехватывает все пути `/api/*` и проксирует на backend. Если исходники в `api/`, Vite пытается проксировать импорты TS-файлов вместо резолва — 404 и белый экран.

### 2. Теневая таблица `slicer_order_state`
Заказы создаются кассой в `docm2_orders` + `docm2tabl1_items` (чужие таблицы). Состояние нарезчика (парковка, merge, статус) хранится в отдельной `slicer_order_state`, связанной по `order_item_id = docm2tabl1_items.suuid`. При GET /api/orders делается JOIN.

### 3. Polling вместо WebSocket
Фронтенд опрашивает `GET /api/orders` каждые 4 секунды. Авто-разпарковка выполняется на backend: при каждом GET обновляет строки где `status='PARKED' AND unpark_at <= NOW()`.

### 4. Префикс `slicer_`
Все таблицы модуля обязаны иметь префикс `slicer_`. Существующие таблицы KDS НЕ модифицируются. Модуль по умолчанию вообще не пишет в чужие таблицы. Единственное опциональное исключение — `rgst3_dishstoplist` при включённой двусторонней синхронизации (раздел 10 Инструкции).

## Критически важные файлы

- `server/src/index.ts` — Express entry, порт 3001
- `server/src/config/db.ts` — pg.Pool подключение
- `server/src/routes/orders.ts` — самый сложный: JOIN docm2 + slicer_order_state, маппинг в Order type
- `server/migrations/001_create_slicer_tables.sql` — SQL базовых 8 таблиц
- `server/migrations/003_dish_aliases.sql` — таблица алиасов
- `server/migrations/004_dish_categories.sql` — таблица ручного назначения категорий
- `services/client.ts` — базовый fetch wrapper
- `hooks/useOrders.ts` — polling + все actions через API
- `BD_docs/` — полная документация для программистов

## Команды запуска
```bash
cd server && npm run dev   # backend :3001
npm run dev                 # frontend :3000
```

## Документация
- `CLAUDE.md` — правила проекта, структура, API endpoints
- `README.md` — инструкции запуска, endpoints
- `BD_docs/README.md` — ER-схема, связи
- `BD_docs/mappings.md` — TypeScript ↔ DB маппинг
- `BD_docs/tables/slicer_*.md` — по одному файлу на таблицу
