# slicer_order_state

## Назначение
Теневая таблица для хранения состояния заказов, специфичного для модуля нарезчика. Заказы создаются в основной KDS (`docm2_orders` + `docm2tabl1_items`), а здесь хранится: статус на доске нарезчика, парковка, merge-состояние стеков, разморозка, точка отсчёта таймера для Варианта Б парковки.

## Метод связывания
`order_item_id` содержит `suuid` из `docm2tabl1_items` (позиция заказа в KDS). Это **не FK** (чужая таблица), а текстовое поле для связи.

При `GET /api/orders` выполняется `LEFT JOIN slicer_order_state ON order_item_id = items.suuid::text`. Если записи нет — заказ считается `ACTIVE` с дефолтными значениями.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Миграция | Описание |
|---|---|---|---|---|---|
| `order_item_id` | VARCHAR(255) | ✅ | — | 001 | **PK**. Ссылка на docm2tabl1_items.suuid |
| `status` | VARCHAR(10) | ✅ | `'ACTIVE'` | 001 | `ACTIVE`, `PARKED`, `COMPLETED`, `CANCELLED` |
| `quantity_stack` | JSONB | ✅ | `[1]` | 001 | Стек количеств: `[2,1]` = не объединено, `[3]` = объединено |
| `table_stack` | JSONB | ✅ | `[[]]` | 001 | Стек столов: `[[8,5],[51]]` = 2 блока |
| `parked_at` | TIMESTAMPTZ | ❌ | `NULL` | 001 | Когда заказ был паркован |
| `unpark_at` | TIMESTAMPTZ | ❌ | `NULL` | 001 | Когда должен авто-вернуться из парковки |
| `accumulated_time_ms` | BIGINT | ❌ | `0` | 001 (семантика 018) | «Общее время парковок» (с 018). Вычитается из elapsed на клиенте |
| `was_parked` | BOOLEAN | ❌ | `FALSE` | 001 | Был ли когда-либо паркован (для разделения KPI) |
| `parked_tables` | JSONB | ❌ | `[]` | 001 | Какие столы были на парковке: `[8, 5]` |
| `finished_at` | TIMESTAMPTZ | ❌ | `NULL` | 007 | Момент нажатия «Готово» нарезчиком. Пара к `docm2tabl1_cooktime` для метрики «время готовки повара» |
| `defrost_started_at` | TIMESTAMPTZ | ❌ | `NULL` | 016 | Момент клика ❄️ (старт разморозки). NULL = разморозка не запускалась |
| `defrost_duration_seconds` | INT | ❌ | `NULL` | 016 | Snapshot `defrost_duration_minutes*60` на момент клика |
| `effective_created_at` | TIMESTAMPTZ | ❌ | `NULL` | 018 | Переопределение точки отсчёта таймера/сортировки. NULL → fallback на `docm2tabl1_ordertime` |
| `parked_by_auto` | BOOLEAN | ✅ | `FALSE` | 018 | Текущая парковка автоматическая (правило автопарковки десертов, миграция 017) |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | 001 | Дата создания записи в state (не путать с `effective_created_at`) |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | 001 | Дата последнего обновления |

## Constraints
- `CHECK (status IN ('ACTIVE', 'PARKED', 'COMPLETED', 'CANCELLED'))`

## Индексы

| Имя | Колонки | Тип | Назначение |
|---|---|---|---|
| `idx_slicer_order_state_status` | `status` | B-tree | Фильтрация активных заказов |
| `idx_slicer_order_state_unpark` | `unpark_at` | Partial (WHERE status='PARKED') | Поиск заказов для авто-разпарковки |
| `idx_slicer_order_state_finished_at` | `finished_at` | Partial (WHERE finished_at IS NOT NULL) | Отчёт «время готовки повара» (007) |
| `idx_slicer_order_state_defrost_active` | `defrost_started_at` | Partial (WHERE defrost_started_at IS NOT NULL) | Быстрый поиск активных разморозок (016) |

## Вариант Б парковки (миграция 018)

Формула таймера на клиенте:
```
pivot   = order.status === 'PARKED' ? parked_at : now
elapsed = (pivot - created_at) - accumulated_time_ms
```

где `created_at = COALESCE(state.effective_created_at, docm2tabl1_ordertime)`.

### Поведение по источнику парковки

| Событие | parked_by_auto | accumulated_time_ms | effective_created_at |
|---|---|---|---|
| Новая позиция (без записи в state) | — | 0 | NULL → ordertime |
| `/park` (ручной) | ← FALSE | не трогаем | не трогаем |
| `/unpark` ручной парковки | → FALSE | += (NOW() − parked_at) | не трогаем |
| `/unpark` автопарковки (гость «несите уже») | → FALSE | = 0 | = NOW() |
| Автопарковка десерта (в GET) | ← TRUE | 0 (default при INSERT) | не трогаем |
| Авто-unpark (`unpark_at ≤ NOW()`), ручная парковка | → FALSE | += (unpark_at − parked_at) | не трогаем |
| Авто-unpark, автопарковка десерта | → FALSE | = 0 | = unpark_at |
| `/restore` | → FALSE | = 0 | = NULL |

Семантика «ручной unpark возвращает на историческое место, автоматический — в конец очереди» достигается за счёт `effective_created_at`.

## Разморозка (миграция 016)

Пара `defrost_started_at` / `defrost_duration_seconds` описывает состояние:
- **NULL** → разморозка не запускалась, на карточке кликабельная ❄️ (если у блюда `requires_defrost=true`).
- **`NOW() < started + duration`** → разморозка идёт, карточка отрисовывается мини-карточкой в DefrostRow над доской (пропускается `smartQueue.flattenOrders`).
- **`NOW() >= started + duration`** → разморозка завершена, карточка снова в очереди. ULTRA-статус сохраняется (если блюдо было ULTRA — остаётся ULTRA). `defrost_started_at` остаётся NOT NULL только как индикатор «проходило разморозку» (серая ❄️ + защита от повторного запуска таймера).

Ручное подтверждение «Разморозилась» backdate'ит `defrost_started_at = NOW() - (duration+1)s` — отдельная колонка «завершено вручную» не нужна.

Парковка сбрасывает `defrost_*` в NULL (парковка доминирует над разморозкой).

## Авто-разпарковка

При каждом `GET /api/orders` backend выполняет (миграция 018, Вариант Б):
```sql
UPDATE slicer_order_state
SET status = 'ACTIVE',
    effective_created_at = CASE WHEN parked_by_auto THEN unpark_at ELSE effective_created_at END,
    accumulated_time_ms = CASE
      WHEN parked_by_auto THEN 0
      ELSE COALESCE(accumulated_time_ms, 0) +
           (EXTRACT(EPOCH FROM (unpark_at - parked_at)) * 1000)::bigint
    END,
    parked_at = NULL,
    unpark_at = NULL,
    parked_by_auto = FALSE,
    updated_at = NOW()
WHERE status = 'PARKED' AND unpark_at IS NOT NULL AND unpark_at <= NOW();
```

## TypeScript маппинг
```typescript
// types.ts → Order
interface Order {
  id: string;                      // → order_item_id
  status: 'ACTIVE' | 'PARKED';    // → status
  quantity_stack: number[];        // → quantity_stack (JSONB)
  table_stack: number[][];         // → table_stack (JSONB)
  created_at: number;              // → COALESCE(effective_created_at, docm2tabl1_ordertime)
  parked_at?: number;              // → parked_at (TIMESTAMPTZ → Unix ms)
  unpark_at?: number;              // → unpark_at
  accumulated_time_ms?: number;    // → accumulated_time_ms (смысл «время парковок» с 018)
  was_parked?: boolean;            // → was_parked
  parked_tables?: number[];        // → parked_tables (JSONB)
  parked_by_auto?: boolean;        // → parked_by_auto (018)
  defrost_started_at?: number | null;     // → defrost_started_at (016)
  defrost_duration_seconds?: number | null; // → defrost_duration_seconds (016)
}
```

## API эндпоинты
- `POST /api/orders/:id/park` — ручная парковка (`parked_by_auto=FALSE`)
- `POST /api/orders/:id/unpark` — ручной unpark (разветвляется по `parked_by_auto`)
- `POST /api/orders/:id/complete` — завершить
- `POST /api/orders/:id/cancel` — отменить
- `POST /api/orders/:id/merge` — объединить стеки
- `POST /api/orders/:id/restore` — вернуть из истории (чистит `effective_created_at` / `accumulated_time_ms` / `parked_by_auto`)
- `POST /api/orders/:id/defrost-start` — запустить таймер разморозки
- `POST /api/orders/:id/defrost-cancel` — отменить активную разморозку
- `POST /api/orders/:id/defrost-complete` — ручное подтверждение «Разморозилась»

Авто-парковка десертов — не через endpoint, а в `GET /api/orders` как UPSERT при первом появлении позиции (миграция 017).

## Важно

`docm2tabl1_items.docm2tabl1_cooked` **не трогается** при `/complete`. Нарезчик закрывает только свою теневую часть (`status='COMPLETED'` + `finished_at=NOW()`). Это из-за того что блюдо может отображаться на других панелях основной KDS (раздача, пасс, мобильное приложение официанта) — см. CLAUDE.md раздел «Неприкосновенность чужой БД».
