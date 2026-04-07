# Smart Wave Aggregation — Архитектура и правила

## Что это
Волновая система построения оптимальной очереди на KDS-доске нарезчика.
Нарезчик просто берёт первый заказ — и это всегда правильно.

## Файлы
- `smartQueue.ts` — core logic: `buildSmartQueue()`, `flattenOrders()`, `getCurrentWave()`, `groupItemsByDish()`
- `SlicerStation.tsx` — интеграция: `useMemo(sortedOrders)`, виртуальные Order[], маппинг действий
- `App.tsx` — при Smart Wave ON: time-window aggregation пропускается (каждый заказ отдельный)
- `AdminPanel.tsx` — UI toggle: "Smart Wave Aggregation" + взаимоблокировка с "Aggregation Window"
- `types.ts` — `FlatOrderItem`, `SmartQueueGroup`

## Алгоритм `buildSmartQueue`
1. Развернуть стеки → `FlatOrderItem[]`
2. Цикл симуляции:
   a. Для каждого стола: волна = первая категория по sort_index
   b. Найти самый старый FIFO bucket среди in-wave элементов
   c. В этом bucket: самая приоритетная категория
   d. УМНАЯ АГРЕГАЦИЯ: взять блюда из bucket + подтянуть одинаковые из других bucket'ов
   e. Другие блюда из новых bucket'ов НЕ вклиниваются
   f. Сгруппировать → позиция в очереди
   g. Удалить обработанные, повторить

## Виртуальные заказы
- `SmartQueueGroup[]` → виртуальные `Order[]` для OrderCard
- Стек сохраняется: каждый source order = отдельный блок (показывает "1 + 1")
- Virtual ID стабильный: `smart_${dishId}_${sourceOrderIds.sort().join('_')}`
- `mergedVirtualIds` — state для отслеживания merged виртуальных заказов
- Done/PartDone резолвятся через `smartQueueMappingRef` на реальные sourceOrderIds

## Настройки по умолчанию
- Smart Wave Aggregation: **ON**
- Aggregation Window: **OFF** (5 мин) — взаимоисключающий с Smart Wave!
- COURSE_FIFO: **10 сек**
- History Retention: **15 мин**

## Критические правила
1. Smart Wave и Aggregation Window — ВЗАИМОИСКЛЮЧАЮЩИЕ (ON одного → OFF другого)
2. При Smart Wave ON: заказы НЕ стекаются в App.tsx
3. НЕ ТРОГАТЬ UI/дизайн без явного разрешения
