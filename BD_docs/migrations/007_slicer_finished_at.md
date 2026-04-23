# Миграция 007: slicer_order_state.finished_at

## Дата выполнения
2026-04-18

## Файл
`server/migrations/007_slicer_finished_at.sql`

## Что делает
1. Добавляет колонку `finished_at TIMESTAMPTZ` в `slicer_order_state` (nullable).
2. Добавляет частичный индекс `idx_slicer_order_state_finished_at` (только где `finished_at IS NOT NULL`).
3. Добавляет `COMMENT ON COLUMN`.

## Зачем понадобилась

До миграции 007 при нажатии нарезчиком «Готово» модуль писал
`UPDATE docm2tabl1_items SET docm2tabl1_cooked = true, docm2tabl1_cooktime = NOW()`
— в **чужую** таблицу основной KDS.

Проблема: поле `docm2tabl1_cooked` может читаться другими панелями
основной KDS (раздача, пасс, мобильное приложение официанта). Нарезчик
— это только **первый этап** приготовления (подготовка ингредиентов),
после него блюдо идёт к повару и только потом — на раздачу. Если
нарезчик жмёт «Готово», а раздача видит `cooked = true` — она может
выдать официанту недоготовленное блюдо.

## Что изменилось

1. **Запись в `docm2tabl1_cooked` убрана** из
   `server/src/routes/orders.ts` (endpoint `POST /api/orders/:id/complete`).
   Модуль больше вообще не пишет в чужие таблицы по умолчанию.

2. **Завершение нарезчиком фиксируется только в теневой таблице:**
   ```sql
   INSERT INTO slicer_order_state (order_item_id, status, finished_at)
   VALUES ($1, 'COMPLETED', NOW())
   ON CONFLICT (order_item_id) DO UPDATE SET
     status = 'COMPLETED',
     finished_at = NOW(),
     updated_at = NOW()
   ```

3. **Новая метрика «время готовки повара»** становится доступна:
   ```
   docm2tabl1_items.docm2tabl1_cooktime  -  slicer_order_state.finished_at
   ≈
   когда раздача отметила готово  -  когда нарезчик сдал позицию
   ≈
   чистое время работы повара
   ```

   При условии, что основная KDS / раздача пишет в `docm2tabl1_cooktime`
   при отметке готовности. Если не пишет — в `Инструкция.md` раздел 11
   предложен опциональный триггер для автозаполнения.

## Колонка

| Колонка | Тип | NOT NULL | Default | Описание |
|---|---|---|---|---|
| `finished_at` | TIMESTAMPTZ | NO | NULL | Момент нажатия нарезчиком «Готово» (status перешёл в COMPLETED). NULL для ACTIVE/PARKED/CANCELLED. |

## Индекс

```sql
CREATE INDEX idx_slicer_order_state_finished_at
  ON slicer_order_state(finished_at)
  WHERE finished_at IS NOT NULL;
```

Частичный индекс — оптимизирует отчёт «время готовки» (выборка только
тех записей, где нарезчик уже закрыл позицию), не раздувает индекс
записями ACTIVE/PARKED.

## Откат

```sql
DROP INDEX IF EXISTS idx_slicer_order_state_finished_at;
ALTER TABLE slicer_order_state DROP COLUMN IF EXISTS finished_at;
```

Миграция полностью обратимая. Откатывать **только** если одновременно
вернуть `UPDATE docm2tabl1_cooked = true` в `server/src/routes/orders.ts`
— иначе нарезчик потеряет способ фиксировать свой момент завершения.

## Совместимость

- **Старые записи** `slicer_order_state` с `status='COMPLETED'`, созданные
  до миграции — имеют `finished_at = NULL`. Это нормально: метрика «время
  готовки повара» для них недоступна (их уже закрыла старая логика с
  записью в `docm2tabl1_cooked`), но в отчётах они просто не участвуют
  (WHERE-фильтр `finished_at IS NOT NULL`).

- **Партиал-комплит** (`POST /api/orders/:id/partial-complete`) не
  выставляет `finished_at` — это операция на оставшемся `quantity_stack`,
  позиция ещё не закрыта полностью. `finished_at` ставится только при
  финальном `complete`.
