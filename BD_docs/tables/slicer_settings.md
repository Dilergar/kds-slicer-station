# slicer_settings

## Назначение
Системные настройки модуля нарезчика. Таблица-singleton: всегда только одна строка с `id = 1`. Содержит все конфигурируемые параметры: рабочие часы, окна агрегации, режимы сортировки, выходные дни.

## Singleton-паттерн
`CHECK (id = 1)` гарантирует что в таблице не может быть более одной строки. При первой миграции вставляется `INSERT INTO slicer_settings DEFAULT VALUES`.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Миграция | Описание |
|---|---|---|---|---|---|
| `id` | INT | ✅ | `1` | 001 | PK, всегда = 1 |
| `aggregation_window_minutes` | INT | ✅ | `5` | 001 | Окно агрегации заказов (1-60 мин) |
| `history_retention_minutes` | INT | ✅ | `15` | 001 | Время хранения истории в UI (1-120 мин) |
| `active_priority_rules` | JSONB | ✅ | `["ULTRA","COURSE_FIFO"]` | 001 | Порядок правил сортировки |
| `course_window_seconds` | INT | ✅ | `10` | 001 | Окно FIFO-bucket для COURSE_FIFO (сек) |
| `restaurant_open_time` | VARCHAR(5) | ✅ | `'12:00'` | 001 | Время открытия ресторана (HH:mm) |
| `restaurant_close_time` | VARCHAR(5) | ✅ | `'23:59'` | 001 | Время закрытия ресторана (HH:mm) |
| `excluded_dates` | JSONB | ✅ | `[]` | 001 | Выходные дни: `["2026-04-09"]` |
| `enable_aggregation` | BOOLEAN | ✅ | `FALSE` | 001 | Стандартная агрегация ВКЛ/ВЫКЛ |
| `enable_smart_aggregation` | BOOLEAN | ✅ | `TRUE` | 001 | Smart Wave агрегация ВКЛ/ВЫКЛ |
| `enable_kds_stoplist_sync` | BOOLEAN | ✅ | `FALSE` | 006 | Двусторонняя синхронизация стоп-листа с `rgst3_dishstoplist` (см. раздел 10 Инструкции) |
| `defrost_duration_minutes` | INT | ✅ | `15` | 016 | Глобальное время разморозки (CHECK 1..60). Snapshot в момент клика ❄️, дальнейшие изменения не сбивают активные таймеры |
| `enable_defrost_sound` | BOOLEAN | ✅ | `TRUE` | 016 | Web Audio beep при истечении таймера мини-карточки разморозки |
| `dessert_category_id` | UUID | ❌ | `NULL` | 017 | FK → `slicer_categories(id)` ON DELETE SET NULL. К какой категории применяется правило авто-парковки десертов. NULL = правило отключено |
| `dessert_auto_park_enabled` | BOOLEAN | ✅ | `FALSE` | 017 | Глобальный тумблер авто-парковки десертов |
| `dessert_auto_park_minutes` | INT | ✅ | `40` | 017 | На сколько минут уходит в парковку десертная позиция (CHECK 1..240) |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | 001 | Дата последнего обновления |

## Constraints
- `CHECK (id = 1)` — singleton
- `CHECK (defrost_duration_minutes BETWEEN 1 AND 60)` — `slicer_settings_defrost_duration_valid` (016)
- `CHECK (dessert_auto_park_minutes BETWEEN 1 AND 240)` — `slicer_settings_dessert_auto_park_minutes_valid` (017)
- `FOREIGN KEY (dessert_category_id) REFERENCES slicer_categories(id) ON DELETE SET NULL` — `slicer_settings_dessert_category_fk` (017)
- `enable_aggregation` и `enable_smart_aggregation` **взаимоисключающие** (логика на уровне приложения)

## Описание настроек

### Агрегация (взаимоисключающие режимы)
- **enable_smart_aggregation = true** (по умолчанию): Smart Wave — волновая агрегация на фронтенде, группирует одинаковые блюда по FIFO-bucket'ам
- **enable_aggregation = true**: Стандартная — физический merge заказов одного блюда в пределах `aggregation_window_minutes`
- **Оба false**: Без агрегации, каждый заказ = отдельная карточка

### Сортировка (active_priority_rules)
Массив правил в порядке приоритета:
- `"ULTRA"` — ULTRA-заказы всегда сверху
- `"COURSE_FIFO"` — гибрид: внутри `course_window_seconds` — по категории, между окнами — FIFO
- `"CATEGORY"` — чисто по sort_index категории
- `"FIFO"` — строго по времени создания

### Рабочие часы и выходные
Используются для расчёта KPI и % стопов в Dashboard:
- Время стопа считается только в рабочие часы
- Выходные дни полностью исключаются из расчёта

## TypeScript маппинг
```typescript
// types.ts → SystemSettings
interface SystemSettings {
  aggregationWindowMinutes: number;     // → aggregation_window_minutes
  historyRetentionMinutes: number;      // → history_retention_minutes
  activePriorityRules: SortRuleType[];  // → active_priority_rules (JSONB)
  courseWindowSeconds: number;          // → course_window_seconds
  restaurantOpenTime: string;           // → restaurant_open_time
  restaurantCloseTime: string;          // → restaurant_close_time
  excludedDates: string[];              // → excluded_dates (JSONB)
  enableAggregation?: boolean;          // → enable_aggregation
  enableSmartAggregation?: boolean;     // → enable_smart_aggregation
  enableKdsStoplistSync?: boolean;      // → enable_kds_stoplist_sync (006)
  defrostDurationMinutes?: number;      // → defrost_duration_minutes (016)
  enableDefrostSound?: boolean;         // → enable_defrost_sound (016)
  dessertCategoryId?: string | null;    // → dessert_category_id (017)
  dessertAutoParkEnabled?: boolean;     // → dessert_auto_park_enabled (017)
  dessertAutoParkMinutes?: number;      // → dessert_auto_park_minutes (017)
}
```

## Примеры SQL

### Получить настройки:
```sql
SELECT * FROM slicer_settings WHERE id = 1;
```

### Обновить рабочие часы:
```sql
UPDATE slicer_settings
SET restaurant_open_time = '10:00', restaurant_close_time = '22:00', updated_at = NOW()
WHERE id = 1;
```

### Переключить на стандартную агрегацию:
```sql
UPDATE slicer_settings
SET enable_smart_aggregation = false, enable_aggregation = true, updated_at = NOW()
WHERE id = 1;
```

### Добавить выходной день:
```sql
UPDATE slicer_settings
SET excluded_dates = excluded_dates || '"2026-04-15"'::jsonb, updated_at = NOW()
WHERE id = 1;
```

## API эндпоинты
- `GET /api/settings` — получить все настройки
- `PUT /api/settings` — обновить настройки (partial update)
