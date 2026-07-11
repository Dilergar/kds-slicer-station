# slicer_settings

## Назначение
Системные настройки модуля нарезчика. Таблица-singleton: всегда только одна строка с `id = 1`. Содержит все конфигурируемые параметры: рабочие часы, окна агрегации, режимы сортировки, выходные дни.

## Singleton-паттерн
`CHECK (id = 1)` гарантирует что в таблице не может быть более одной строки. При первой миграции вставляется `INSERT INTO slicer_settings DEFAULT VALUES`.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Миграция | Описание |
|---|---|---|---|---|---|
| `id` | INT | ✅ | `1` | 001 | PK, всегда = 1 |
| `aggregation_window_minutes` | INT | ✅ | `5` | 001 | ⚠️ ЛЕГАСИ (не используется). Лимит времени слияния убран — режим скорости сливает безлимитно |
| `history_retention_minutes` | INT | ✅ | `15` | 001 | Время хранения истории в UI (1-120 мин) |
| `active_priority_rules` | JSONB | ✅ | `["ULTRA","COURSE_FIFO"]` | 001 | Порядок правил сортировки (только СТАНДАРТНЫЙ режим, оба тумблера OFF) |
| `course_window_seconds` | INT | ✅ | `10` | 001 | Окно FIFO-bucket для COURSE_FIFO. Используется в СТАНДАРТНОЙ сортировке (умная перешла на `course_pace_seconds`) |
| `course_pace_seconds` | INT | ✅ | `600` | 023, 024, 025 | Шаг курса умной очереди v2 «Темп курсов» — «окно уступки»: на сколько курс N стола уступает первым курсам более новых гостей. vt позиции = старт визита + номер_курса × шаг; после наступления vt позицию никто не обгонит. Нарезку не замедляет. CHECK 10..3600 (миграция 025, симметрично API-валидации) |
| `restaurant_open_time` | VARCHAR(5) | ✅ | `'12:00'` | 001 | Время открытия ресторана (HH:mm) |
| `restaurant_close_time` | VARCHAR(5) | ✅ | `'23:59'` | 001 | Время закрытия ресторана (HH:mm) |
| `excluded_dates` | JSONB | ✅ | `[]` | 001 | Выходные дни: `["2026-04-09"]` |
| `enable_aggregation` | BOOLEAN | ✅ | `FALSE` | 001 | Стандартная агрегация ВКЛ/ВЫКЛ |
| `enable_smart_aggregation` | BOOLEAN | ✅ | `TRUE` | 001 | Smart Wave агрегация ВКЛ/ВЫКЛ |
| `enable_kds_stoplist_sync` | BOOLEAN | ✅ | `FALSE` | 006 | Двусторонняя синхронизация стоп-листа с `rgst3_dishstoplist` (см. раздел 10 Инструкции) |
| `enable_defrost_sound` | BOOLEAN | ✅ | `TRUE` | 016 | Web Audio beep при истечении таймера мини-карточки разморозки. Время разморозки per-dish в `slicer_dish_defrost.defrost_duration_minutes` (миграция 020 удалила глобальную колонку `defrost_duration_minutes`) |
| `dessert_category_id` | UUID | ❌ | `NULL` | 017 | FK → `slicer_categories(id)` ON DELETE SET NULL. К какой категории применяется правило авто-парковки десертов. NULL = правило отключено |
| `dessert_auto_park_enabled` | BOOLEAN | ✅ | `FALSE` | 017 | Глобальный тумблер авто-парковки десертов |
| `dessert_auto_park_minutes` | INT | ✅ | `40` | 017 | На сколько минут уходит в парковку десертная позиция (CHECK 1..240) |
| `dessert_trigger_modifier_patterns` | TEXT[] | ✅ | `{Готовить%, Ждать%}` | 019 | Паттерны LIKE для имён модификаторов из `ctlg20_modifiers` — при наличии хотя бы одного совпадения у дессертной позиции срабатывает авто-парковка. Имя вида «Готовить к HH.MM» → парковка до сегодняшних HH:MM; иначе → на `dessert_auto_park_minutes` |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | 001 | Дата последнего обновления |

## Constraints
- `CHECK (id = 1)` — singleton
- `CHECK (dessert_auto_park_minutes BETWEEN 1 AND 240)` — `slicer_settings_dessert_auto_park_minutes_valid` (017)
- (Миграция 020 удалила `CHECK (defrost_duration_minutes BETWEEN 1 AND 60)` вместе с самой колонкой — правило переехало в `slicer_dish_defrost`.)
- `FOREIGN KEY (dessert_category_id) REFERENCES slicer_categories(id) ON DELETE SET NULL` — `slicer_settings_dessert_category_fk` (017)
- `enable_aggregation` и `enable_smart_aggregation` **взаимоисключающие** (логика на уровне приложения)

## Описание настроек

### Два режима очереди (взаимоисключающие) + стандартная сортировка
- **enable_smart_aggregation = true** (по умолчанию): **«Волновая (Умная)» v2 «Темп курсов»** — каждый гость идёт по своим курсам, `vt = старт визита + номер_курса × course_pace_seconds`, одинаковые блюда сливаются без нарушения курсов. Курсы «заморожены» по визиту (миграция 024 / ревью 2026-07-11): считаются по всем позициям, включая уже отданные (`GET /api/orders` отдаёт `visit_completed_dish_ids` / `visit_started_at` из `slicer_order_state COMPLETED` открытых чеков) — «Готово» не пересобирает очередь. Честность по времени прихода + защита от голодания.
- **enable_aggregation = true**: **«Окно Агрегации» (режим скорости)** — без порядка категорий, безлимитное слияние одинаковых блюд, строгий FIFO по первому заказу. `aggregation_window_minutes` НЕ используется (легаси).
- **Оба false**: стандартная сортировка (`active_priority_rules` + `course_window_seconds`), каждая позиция чека = отдельная карточка.

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
  courseWindowSeconds: number;          // → course_window_seconds (стандартный режим)
  coursePaceSeconds?: number;           // → course_pace_seconds (023, умная v2)
  restaurantOpenTime: string;           // → restaurant_open_time
  restaurantCloseTime: string;          // → restaurant_close_time
  excludedDates: string[];              // → excluded_dates (JSONB)
  enableAggregation?: boolean;          // → enable_aggregation
  enableSmartAggregation?: boolean;     // → enable_smart_aggregation
  enableKdsStoplistSync?: boolean;      // → enable_kds_stoplist_sync (006)
  // defrostDurationMinutes удалён в миграции 020 — время per-dish в Dish.defrost_duration_minutes
  enableDefrostSound?: boolean;         // → enable_defrost_sound (016)
  dessertCategoryId?: string | null;    // → dessert_category_id (017)
  dessertAutoParkEnabled?: boolean;     // → dessert_auto_park_enabled (017)
  dessertAutoParkMinutes?: number;      // → dessert_auto_park_minutes (017)
  dessertTriggerModifierPatterns?: string[]; // → dessert_trigger_modifier_patterns (019)
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
