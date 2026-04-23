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

## Устойчивость smartQueue к незавершённым данным
`flattenOrders` в `smartQueue.ts` защищён от трёх «скрытых» выпадений заказов:

1. **Блюдо без категории** → пропускается (не попадает на доску). Семантика: блюдо готовое (рис отварной, пампушки), отдаётся на раздаче, не проходит через нарезчика. Реализация: `GET /api/orders` фильтрует через `EXISTS slicer_dish_categories` по каноническому dish_id (после резолва алиаса); `getPrimaryCategory` возвращает `null` и `flattenOrders` делает `continue`. `UNCATEGORIZED_CATEGORY` fallback удалён. Для новых блюд меню секция "Без категории" в RecipeEditor служит todo-листом настройки.
2. **Пустой `table_stack: [[]]`** → fallback на `quantity_stack[blockIdx]` с `tableNumber=0`. Нужно для заказов без привязки к столу (доставка, тестовые заказы, битая связка с ctlg13).
3. **Алиасы в тест-заказах** → группировка по каноническому id: `canonicalDishId = rawDish.recipe_source_id || rawDish.id`. Имя и категории берутся у primary-блюда. Для реальных `/api/orders` это no-op (бэк уже COALESCE-ит dish_id), но тест-заказы добавляются локально с оригинальным alias_dish_id — без этого Д90 и 90 показывались бы двумя разными карточками.
