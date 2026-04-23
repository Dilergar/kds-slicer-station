# slicer_stop_history

## Назначение
Лог всех событий стоп-листа: когда ингредиент/блюдо был поставлен на стоп и когда снят. Используется в Dashboard для расчёта "% времени на стопе" с учётом рабочих часов ресторана и выходных дней.

## Когда создаётся запись
При **снятии** ингредиента или блюда со стопа (`POST /api/stoplist/toggle`). В момент постановки на стоп запись НЕ создаётся — только при снятии, когда можно вычислить `duration_ms`.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Миграция | Описание |
|---|---|---|---|---|---|
| `id` | UUID | ✅ | `gen_random_uuid()` | 001 | Первичный ключ |
| `target_type` | VARCHAR(20) | ✅ | — | 001 | `'ingredient'` или `'dish'` |
| `target_id` | VARCHAR(255) | ✅ | — | 001 | UUID ингредиента или блюда |
| `target_name` | VARCHAR(255) | ✅ | — | 001 (формат `"<code> <name>"` для dish — 012) | Название для отчётности |
| `stopped_at` | TIMESTAMPTZ | ✅ | — | 001 | Когда был поставлен на стоп |
| `resumed_at` | TIMESTAMPTZ | ❌ | `NULL` | 001 | Когда был снят со стопа |
| `reason` | VARCHAR(255) | ❌ | `NULL` | 001 | Причина стопа |
| `duration_ms` | BIGINT | ❌ | `NULL` | 001 | Длительность стопа в миллисекундах |
| `stopped_by_uuid` | UUID | ❌ | `NULL` | 014 | UUID актора который поставил стоп (из users) |
| `stopped_by_name` | VARCHAR(255) | ❌ | `NULL` | 014 | Имя/логин актора поставившего стоп |
| `resumed_by_uuid` | UUID | ❌ | `NULL` | 014 | UUID актора который снял стоп |
| `resumed_by_name` | VARCHAR(255) | ❌ | `NULL` | 014 | Имя/логин актора снявшего стоп |
| `actor_source` | VARCHAR(20) | ❌ | `NULL` | 014 | Источник: `'slicer'` (наш модуль), `'kds'` (основная KDS), `'cascade'` (автоматический каскад от ингредиента) |
| `created_at` | TIMESTAMPTZ | ✅ | `NOW()` | 001 | Дата создания записи |

## Constraints
- `CHECK (target_type IN ('ingredient', 'dish'))`

## Индексы

| Имя | Колонки | Назначение |
|---|---|---|
| `idx_slicer_stop_history_target` | `target_id` | Поиск всех стопов конкретного ингредиента |
| `idx_slicer_stop_history_time` | `stopped_at` | Фильтрация по дате для Dashboard |

## Расчёт % времени на стопе (Dashboard)
Dashboard использует `calculateBusinessOverlap()` для подсчёта:
1. Берёт `stopped_at` и `resumed_at` каждой записи
2. Считает пересечение с рабочими часами (`restaurant_open_time` → `restaurant_close_time`)
3. Исключает дни из `excluded_dates`
4. Делит фактическое время стопа на общее рабочее время → процент

## TypeScript маппинг
```typescript
// types.ts → StopHistoryEntry
interface StopHistoryEntry {
  id: string;            // → id
  ingredientName: string; // → target_name
  stoppedAt: number;     // → stopped_at (TIMESTAMPTZ → Unix ms)
  resumedAt: number;     // → resumed_at (TIMESTAMPTZ → Unix ms)
  reason: string;        // → reason
  durationMs: number;    // → duration_ms
  // Актор (миграция 014)
  stoppedByUuid?: string | null;
  stoppedByName?: string | null;
  resumedByUuid?: string | null;
  resumedByName?: string | null;
  actorSource?: 'slicer' | 'kds' | 'cascade' | null;
}
```

## Примеры SQL

### Записать снятие со стопа:
```sql
INSERT INTO slicer_stop_history (target_type, target_id, target_name, stopped_at, resumed_at, reason, duration_ms)
VALUES (
  'ingredient',
  'uuid-ингредиента',
  'Картофель сырой',
  '2026-04-10 12:30:00+05',
  '2026-04-10 13:15:00+05',
  'Out of Stock',
  2700000  -- 45 минут
);
```

### Отчёт: все стопы за период:
```sql
SELECT target_name, target_type, reason,
       stopped_at, resumed_at, duration_ms,
       ROUND(duration_ms / 60000.0, 1) AS duration_minutes
FROM slicer_stop_history
WHERE stopped_at >= '2026-04-10' AND stopped_at < '2026-04-11'
ORDER BY stopped_at DESC;
```

### Суммарное время на стопе по ингредиенту:
```sql
SELECT target_name,
       COUNT(*) AS stop_count,
       SUM(duration_ms) AS total_duration_ms,
       ROUND(SUM(duration_ms) / 60000.0, 1) AS total_minutes
FROM slicer_stop_history
WHERE stopped_at >= $1 AND stopped_at <= $2
GROUP BY target_name
ORDER BY total_duration_ms DESC;
```

## API эндпоинты
- `GET /api/stoplist/history?from=&to=` — получить историю стопов
- `POST /api/stoplist/toggle` — при снятии со стопа автоматически создаёт запись
