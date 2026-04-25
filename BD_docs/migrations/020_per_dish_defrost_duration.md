# Миграция 020: Per-dish время разморозки

**Дата:** 2026-04-23
**Файл:** `server/migrations/020_per_dish_defrost_duration.sql`

## Цель

Перенести длительность разморозки с глобальной настройки на per-dish значение — разные замороженные блюда размораживаются по-разному (рыба 15 мин, курица 25 мин и т.п.). Администратор задаёт время в редакторе рецепта рядом с флагом «Требует разморозки?».

## Что меняется

### `slicer_dish_defrost`
- **Новая колонка:** `defrost_duration_minutes INT NOT NULL DEFAULT 15`
- **Новый constraint:** `slicer_dish_defrost_duration_valid` — `CHECK (defrost_duration_minutes BETWEEN 1 AND 60)`
- **Миграция данных:** в существующие строки копируется текущее значение из `slicer_settings.defrost_duration_minutes` (Вариант А — уже настроенные блюда получают предыдущее глобальное время 1:1, поведение не меняется на ходу).

### `slicer_settings`
- **Удалена колонка:** `defrost_duration_minutes`
- **Удалён constraint:** `slicer_settings_defrost_duration_valid`

### Что НЕ трогается
- `slicer_settings.enable_defrost_sound` — реально глобальный toggle (вкл/выкл звук), остаётся как есть.
- `slicer_order_state.defrost_duration_seconds` — snapshot на момент старта таймера. Защищает активные разморозки от изменения настроек. Источник значения при INSERT'е меняется (читается из `slicer_dish_defrost`, а не из `slicer_settings`), а колонка остаётся.
- Чужая схема (`ctlg*`, `docm2_*`, `rgst*`) не трогается.

## Код, который изменился

- `server/src/routes/dishes.ts` — GET `/api/dishes` отдаёт `defrost_duration_minutes` per-dish. PUT `/api/dishes/:dishId/defrost` принимает `{ requires_defrost, defrost_duration_minutes }`.
- `server/src/routes/orders.ts` — POST `/api/orders/:id/defrost-start` читает длительность из `slicer_dish_defrost` через JOIN (резолв alias→primary), а не из `slicer_settings`.
- `server/src/routes/settings.ts` — `defrostDurationMinutes` удалён из GET/PUT.
- `services/dishesApi.ts` — `updateDishDefrost(dishId, requires, minutes?)` с опциональным третьим аргументом.
- `components/admin/RecipeEditor.tsx` — рядом с тумблером «Да/Нет» показывается input минут (1..60), только когда выбрано «Да».
- `components/admin/SystemSettingsTab.tsx` — блок «Время разморозки» удалён, осталась только настройка звука.
- `hooks/useOrders.ts` — оптимистичный апдейт `handleStartDefrost` берёт duration из `dishMap`, а не из `settings`.
- `types.ts` — `Dish.defrost_duration_minutes?: number` добавлен; `SystemSettings.defrostDurationMinutes` удалён.

## Откат

```sql
-- Вернуть колонку в slicer_settings
ALTER TABLE slicer_settings ADD COLUMN defrost_duration_minutes INT NOT NULL DEFAULT 15;
ALTER TABLE slicer_settings
  ADD CONSTRAINT slicer_settings_defrost_duration_valid
  CHECK (defrost_duration_minutes BETWEEN 1 AND 60);

-- Восстановить глобальное значение из самой частой per-dish настройки (или из любой строки)
UPDATE slicer_settings SET defrost_duration_minutes = (
  SELECT defrost_duration_minutes FROM slicer_dish_defrost
  WHERE requires_defrost = true LIMIT 1
) WHERE id = 1;

-- Убрать колонку из slicer_dish_defrost
ALTER TABLE slicer_dish_defrost DROP CONSTRAINT IF EXISTS slicer_dish_defrost_duration_valid;
ALTER TABLE slicer_dish_defrost DROP COLUMN defrost_duration_minutes;
```

Откат разрушителен для per-dish значений, отличающихся от глобального — они теряются. На проде перед откатом сохранить таблицу в дамп.
