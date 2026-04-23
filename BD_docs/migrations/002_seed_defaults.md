# Миграция 002: Начальные данные

## Дата выполнения
2026-04-10

## Файл
`server/migrations/002_seed_defaults.sql`

## Что делает
Вставляет начальные данные в две таблицы:

### slicer_settings (singleton)
Настройки по умолчанию — одна строка с id=1:
- aggregation_window_minutes: 5
- history_retention_minutes: 15
- active_priority_rules: ["ULTRA", "COURSE_FIFO"]
- course_window_seconds: 10
- restaurant_open_time: "12:00"
- restaurant_close_time: "23:59"
- enable_smart_aggregation: true

### slicer_categories (5 записей)
| sort_index | name |
|---|---|
| 0 | VIP |
| 1 | Супы |
| 2 | Салаты |
| 3 | Горячее |
| 4 | Десерты |

## Как выполнить на продакшне
```bash
PGPASSWORD=<пароль> psql -U postgres -d arclient -f server/migrations/002_seed_defaults.sql
```

## Идемпотентность
Использует `ON CONFLICT DO NOTHING` — безопасно запускать повторно.
