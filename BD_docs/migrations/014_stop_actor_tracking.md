# Миграция 014 — Отслеживание актора стопов

**Дата:** 2026-04-23
**Файл:** `server/migrations/014_stop_actor_tracking.sql`

## Зачем

Заказчик захотел видеть в «Истории Стоп-листов», **кто именно** поставил стоп и кто снял — чтобы в отчётах можно было разобрать ответственность по сотрудникам.

## Что добавлено

### `slicer_stop_history` — +5 колонок
| Колонка | Тип | Назначение |
|---|---|---|
| `stopped_by_uuid` | UUID | `users.uuid` поставившего стоп |
| `stopped_by_name` | TEXT | Кэшированное ФИО на момент стопа |
| `resumed_by_uuid` | UUID | `users.uuid` снявшего стоп (NULL для kds-источника) |
| `resumed_by_name` | TEXT | ФИО снявшего |
| `actor_source` | TEXT | `'slicer'` / `'kds'` / `'cascade'` |

### `slicer_dish_stoplist` — +3 колонки
`stopped_by_uuid`, `stopped_by_name`, `actor_source` — чтобы при снятии стопа можно было заполнить `resumed_by_*` в history, а `stopped_by_*` не терялся.

### `slicer_ingredients` — +2 колонки
`stopped_by_uuid`, `stopped_by_name` — аналогично, для переноса в history при снятии.

## Почему кэшируем имя отдельно от UUID

- Один JOIN к `users` только при записи, при чтении отчётов — не нужен.
- Если юзера удалят или переименуют, в истории остаётся ФИО на момент действия. Это правильная аудит-семантика.

## Ретро-заполнение старых записей

**Не делаем.** Для записей до миграции 014 все `actor_*` = NULL, UI показывает «—» в колонке «Кто». Достоверно узнать автора задним числом нельзя — в rgst3 соответствующий row уже мог быть удалён, а `slicer_stop_history` раньше actor'а вообще не хранил.

## Как заполняются новые поля

1. **slicer (наш модуль):** `POST /api/stoplist/toggle` принимает `actorUuid` + `actorName` в body (из `useAuth` на фронте).
2. **kds (живые rgst3):** `GET /api/stoplist/history` делает `LEFT JOIN users ON u.uuid::text = r.inserter`.
3. **kds через DELETE:** триггер `slicer_archive_rgst3_delete` (обновлён в миграции 015) резолвит `OLD.inserter` через `users`.
4. **cascade:** `recalculateCascadeStops(client, actor)` копирует actor triggering-toggle в новые CASCADE-строки.

## Смотри также

- Миграция 015 — обновлённый триггер архивации
- `server/src/routes/stoplist.ts` — логика записи актора
- `components/dashboard/StopListHistorySection.tsx` — UI с `<ActorLine>`
