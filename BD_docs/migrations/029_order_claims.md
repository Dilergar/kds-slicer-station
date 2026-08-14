# Миграция 029: Общий клейм «В работе» + автор порции в истории

## Дата выполнения
2026-08-15

## Файл
`server/migrations/029_order_claims.sql`

## Что делает
- `slicer_order_state`: `claimed_by_uuid VARCHAR(255)`, `claimed_by_name VARCHAR(255)`, `claimed_at TIMESTAMPTZ` — кто держит позицию в работе (NULL = свободна).
- `slicer_order_history`: `completed_by_uuid VARCHAR(255)`, `completed_by_name VARCHAR(255)` — кто нажал «Готово»/«Частично».
- Индекс `idx_slicer_order_history_completed_by (completed_by_uuid, completed_at)`, частичный (`WHERE completed_by_uuid IS NOT NULL`) — фильтр отчёта по нарезчику внутри периода.

## Зачем
Режим работы на 2–3 нарезчиков. Тап по карточке помечал её «В работе» (лаймовая рамка + 🔪), но метка жила **только в локальном стейте одного браузера**. За одним планшетом этого хватало; когда нарезчики стоят в разных концах кухни с разными планшетами — нет: второй не видел, что блюдо уже кто-то взял, и резал его повторно.

Клейм переехал в теневую таблицу и раздаётся всем планшетам обычным `GET /api/orders` (поллинг 4 сек). Личность берётся из PIN-сессии (`users.uuid` + `users.login`), поэтому на карточке видно конкретного человека, а не безличное «занято».

## Как работает

| Действие | Что происходит |
|---|---|
| Тап по свободной карточке | `POST /api/orders/claim` со ВСЕМИ реальными позициями карточки → лаймовая рамка + своё имя |
| Тап по своей карточке | `POST /api/orders/unclaim` → метка снимается |
| Тап по чужой карточке | ничего. Снять чужой клейм нельзя |
| «Готово» / «Частично» на чужой | модалка «Карточку взял Азамат» → «Отмена» / «Всё равно отдать» |
| Парковка | клейм снимается |
| Разморозка | клейм сохраняется (мини-карточка в `DefrostRow` тоже подписана) |
| `/restore` из истории | клейм сбрасывается |

**Карточка атомарна.** В агрегированных режимах одна карточка склеена из нескольких позиций, и на соседнем планшете та же рыба может быть разбита иначе. Поэтому:
- если хоть одна позиция занята другим нарезчиком, весь `claim` отклоняется с `409` и именем владельца;
- карточка считается занятой, если занята хотя бы одна позиция (владелец — с самым ранним `claimed_at`, одинаково на всех устройствах).

**Гонка двух планшетов** разрешается в БД, а не в UI: `ON CONFLICT DO UPDATE ... WHERE claimed_by_uuid IS NULL OR = наш` под READ COMMITTED перечитывает строку после коммита соперника и ничего не перетирает; финальная проверка внутри транзакции ловит остаток случаев и откатывает клейм целиком.

**Автор порции** в истории — тот, кто НАЖАЛ «Готово», а не тот, кто держал клейм: закрыть чужую карточку можно, и в KPI должен попасть фактический исполнитель.

## Изменения в коде
- `server/src/routes/orders.ts` — эндпоинты `POST /api/orders/claim` и `POST /api/orders/unclaim`; `claimed_*` в SELECT и маппинге `GET /api/orders`; `completed_by_*` в INSERT истории (`/complete`, `/partial-complete`); сброс клейма в `/park` и `/restore`.
- `server/src/routes/history.ts` — `completedByUuid` / `completedByName` в выдаче `GET /api/history/orders`.
- `services/ordersApi.ts` — `claimOrders()`, `unclaimOrders()`, актор в `completeOrder`/`partialCompleteOrder`.
- `hooks/useOrders.ts` — `handleClaimOrders` / `handleReleaseOrders` (оптимистично + защита от отката поллингом через `pendingClaimRef`), `claimError` для уведомления «карточку уже взял …».
- `components/SlicerStation.tsx` — локальный `inWorkIds` удалён; клейм берётся из `order.claimed_by_*`, пробрасывается в виртуальные карточки очереди и в группы разморозки; модалка подтверждения для чужих карточек.
- `components/OrderCard.tsx` — своя карточка лаймовая, чужая голубая, у обеих подпись «🔪 имя».
- `components/DefrostRow.tsx`, `components/DefrostModal.tsx` — показ клейма на разморозке.
- `components/dashboard/SpeedKpiSection.tsx` — фильтр «нарезчик» + имя в детализации порций.
- `services/excelExport.ts` — колонка «Нарезчик» на листах скорости + пометка о применённом фильтре.
- `types.ts` — `Order.claimed_by_*`, `OrderHistoryEntry.completedBy*`.

## Откат
```sql
ALTER TABLE slicer_order_state
  DROP COLUMN IF EXISTS claimed_by_uuid,
  DROP COLUMN IF EXISTS claimed_by_name,
  DROP COLUMN IF EXISTS claimed_at;

DROP INDEX IF EXISTS idx_slicer_order_history_completed_by;
ALTER TABLE slicer_order_history
  DROP COLUMN IF EXISTS completed_by_uuid,
  DROP COLUMN IF EXISTS completed_by_name;
```
Без этих колонок фронт получает `claimed_by_uuid = undefined` — карточки просто перестают показывать, кто их взял; ошибок нет, но `POST /api/orders/claim` начнёт отвечать 500, поэтому откатывать только вместе с кодом.
