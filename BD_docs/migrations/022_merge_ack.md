# Миграция 022: Персист merge-подтверждения виртуальных карточек Smart Wave

## Дата выполнения
2026-07-06

## Файл
`server/migrations/022_merge_ack.sql`

## Что делает
Добавляет колонку `merge_ack BOOLEAN NOT NULL DEFAULT FALSE` в `slicer_order_state`.

## Зачем
В Smart Wave несколько реальных позиций (source-заказов) одного блюда собираются в одну виртуальную карточку со стеком «1 + 1 + 1». Кнопка Merge («объедините их») раньше фиксировала подтверждение только в локальном React-стейте `SlicerStation` (`mergedSources`): любое переключение вкладки, F5 или второй планшет сбрасывали состояние — карточки снова показывали «1+1» и блокировали «ГОТОВО» до повторного Merge. При этом merge обычного (не виртуального) заказа персистился в БД — поведение было неконсистентным.

## Как работает
- Merge виртуальной карточки → `POST /api/orders/merge-ack` c `{orderItemIds: [...]}` → каждому source-заказу проставляется `merge_ack = TRUE` (UPSERT; при INSERT свежей строки реальные `quantity_stack`/`table_stack` подтягиваются SELECT-ом из `docm2tabl1_items` + `ctlg13_halltables`, чтобы DEFAULT'ы `'[1]'`/`'[[]]'` не перетёрли реальные количество и стол — та же ловушка, что была в defrost-start).
- Рендер виртуальной карточки: все source-ы с `merge_ack=TRUE` → один объединённый блок стека; каждый новый source (FALSE по умолчанию) — отдельный блок → карточка показывает «2 + 1» и снова требует Merge.
- `GET /api/orders` отдаёт `merge_ack` в каждом Order (нет строки state → `false`).

## Сброс
| Событие | merge_ack |
|---|---|
| Новая позиция | FALSE (default) |
| `/restore` (возврат из истории) | → FALSE («чистый лист») |
| Парковка / разморозка | не трогают |

## Изменения в коде
- `server/src/routes/orders.ts` — новый endpoint `POST /api/orders/merge-ack`; `state.merge_ack` в SELECT + маппинге `GET /api/orders`; сброс `merge_ack=FALSE` в `/restore`.
- `services/ordersApi.ts` — `mergeAckOrders(orderItemIds)`.
- `hooks/useOrders.ts` — `handleMergeAck` (оптимистичное обновление + API).
- `components/SlicerStation.tsx` — сборка стека виртуальной карточки по `order.merge_ack` вместо локального `mergedSources` (state удалён); Merge виртуальной карточки вызывает `onMergeAck`.
- `types.ts` — поле `Order.merge_ack?`.

## Откат
```sql
ALTER TABLE slicer_order_state DROP COLUMN IF EXISTS merge_ack;
```
Фронт при отсутствии поля считает все позиции неподтверждёнными (каждый source — отдельный блок), функциональность деградирует до «merge не переживает polling», ошибок нет.
