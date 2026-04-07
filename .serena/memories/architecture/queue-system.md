# Очередь KDS Slicer Station — Как работает

## Два режима очереди (взаимоисключающие)

### 1. Smart Wave Aggregation (по умолчанию ON)
- Строит очередь по категориям (суп→салат→горячее→десерт) для каждого стола
- Одинаковые блюда из разных столов объединяются в одну карточку
- FIFO через bucket'ы (courseWindowSeconds = 10 сек)
- Каждый заказ — отдельный Order (App.tsx НЕ стекает)
- Логика в `smartQueue.ts` → `buildSmartQueue()`

### 2. Aggregation Window (по умолчанию OFF)
- Простое time-window стекирование
- Заказы на одно блюдо в пределах N минут сливаются в один Order
- Нет волн, нет категорий — просто дедупликация
- Логика в `App.tsx`

## Формат данных стека
```
quantity_stack: [2, 1]  → "2 + 1" (не объединён)
table_stack: [[8, 5], [51]]

После merge: quantity_stack: [3], table_stack: [[8, 5, 51]]
```

## OrderCard индикаторы
- `quantity_stack.length > 1` → "1 + 1", красная стрелка, "ЕЩЁ ЗАКАЗ", Done заблокирован
- `quantity_stack.length === 1` → число, кнопка Done доступна
- Part Done — всегда доступна если totalQty > 1

## Сортировка (стандартная, при Smart Wave OFF)
Правила приоритета (в `SlicerStation.tsx`):
1. ULTRA — всегда первый
2. COURSE_FIFO — категория по sort_index, внутри неё FIFO по created_at
