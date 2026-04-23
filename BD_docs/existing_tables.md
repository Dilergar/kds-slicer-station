# Существующие таблицы KDS (только чтение)

Эти таблицы принадлежат основной KDS-системе. Модуль нарезчика ЧИТАЕТ из них данные.

**По умолчанию модуль НЕ пишет в эти таблицы.** Статус завершения нарезки
хранится в собственной `slicer_order_state` (теневая таблица). Единственное
опциональное исключение — `rgst3_dishstoplist` (INSERT/DELETE при включённой
двусторонней синхронизации стоп-листа, см. `Инструкция.md` раздел 10).

`docm2tabl1_items.docm2tabl1_cooked` / `docm2tabl1_cooktime` — под управлением
вашей основной KDS; модуль их читает для измерения «времени готовки повара»
(`Инструкция.md` раздел 11), но не пишет туда.

---

## docm2_orders

**Назначение:** Заказы ресторана (создаются кассовой системой).

| Колонка | Тип | Описание |
|---|---|---|
| `id` | INT | Auto-increment PK |
| `suuid` | UUID | Бизнес-ключ заказа |
| `docm2_opentime` | TIMESTAMP | Время открытия заказа |
| `docm2_closetime` | TIMESTAMP | Время закрытия (null = открыт) |
| `docm2_closed` | BOOLEAN | Закрыт ли заказ |
| `docm2_ctlg13_uuid__halltable` | UUID | FK → ctlg13_halltables.suuid (стол) |
| `docm2_ctlg12_uuid__hall` | UUID | FK → ctlg12_halls.suuid (зал) |
| `docm2_ctlg14_uuid__shift` | UUID | FK → ctlg14_shifts.suuid (смена) |
| `docm2_ctlg5_uuid__garcon` | UUID | FK → ctlg5_employees.suuid (официант) |
| `docm2_total` | NUMERIC(21,2) | Итого |
| `docm2_dishtotal` | NUMERIC(21,2) | Итого по блюдам |
| `docnumber` | TEXT | Номер документа |
| `insert_date` | TIMESTAMP | Дата создания записи |

**Связь с модулем:** Читаем открытые заказы (`docm2_closed = false`), получаем номер стола через JOIN с `ctlg13_halltables`.

---

## docm2tabl1_items

**Назначение:** Позиции (строки) заказа — конкретные блюда с количествами.

| Колонка | Тип | Описание |
|---|---|---|
| `id` | INT | Auto-increment PK |
| `suuid` | UUID | Бизнес-ключ позиции |
| `owner` | UUID | FK → docm2_orders.suuid (родительский заказ) |
| `docm2tabl1_ctlg15_uuid__dish` | UUID | FK → ctlg15_dishes.suuid (блюдо) |
| `docm2tabl1_quantity` | NUMERIC(21,3) | Количество порций |
| `docm2tabl1_price` | NUMERIC(21,2) | Цена за единицу |
| `docm2tabl1_sum` | NUMERIC(21,2) | Сумма (цена × количество) |
| `docm2tabl1_cooked` | BOOLEAN | Приготовлено (пишет основная KDS, модуль только читает) |
| `docm2tabl1_confirmed` | BOOLEAN | Подтверждено |
| `docm2tabl1_supplied` | BOOLEAN | Выдано |
| `docm2tabl1_ordertime` | TIMESTAMP | Время заказа позиции |
| `docm2tabl1_cooktime` | TIMESTAMP | Время приготовления |
| `docm2tabl1_confirmtime` | TIMESTAMP | Время подтверждения |
| `docm2tabl1_note` | TEXT | Примечание к позиции |
| `rownumber` | INT | Номер строки в заказе |

**Связь с модулем:**
- ЧТЕНИЕ: `owner` → `docm2_orders.suuid`, `docm2tabl1_ctlg15_uuid__dish` → `ctlg15_dishes.suuid`
- ЗАПИСЬ: **отсутствует**. Модуль не пишет в `docm2tabl1_cooked` / `docm2tabl1_cooktime` — они остаются под управлением основной KDS.
- Для измерения времени готовки повара: `docm2tabl1_cooktime - slicer_order_state.finished_at` (см. `Инструкция.md` раздел 11).

---

## ctlg15_dishes

**Назначение:** Справочник блюд ресторана.

| Колонка | Тип | Описание |
|---|---|---|
| `id` | INT | Auto-increment PK |
| `suuid` | UUID | Бизнес-ключ блюда |
| `name` | TEXT | Название блюда |
| `code` | TEXT | Код блюда |
| `ctlg15_ctlg38_uuid__goodcategory` | UUID | FK → ctlg38_goodcategories.suuid |
| `ctlg15_description` | TEXT | Описание |
| `ctlg15_article` | TEXT | Артикул |
| `ctlg15_discountoff` | BOOLEAN | Скидка отключена |
| `ctlg15_kzname` | TEXT | Казахское название |
| `isfolder` | BOOLEAN | Это папка (группировка) |
| `folder` | UUID | Родительская папка |

**Связь с модулем:** Читаем для получения названий блюд. `suuid` используется как `dish_id` в `slicer_recipes` и `slicer_order_history`.

---

## ctlg13_halltables

**Назначение:** Столы в залах ресторана.

| Колонка | Тип | Описание |
|---|---|---|
| `suuid` | UUID | Бизнес-ключ стола |
| `name` | TEXT | Название |
| `ctlg13_tablenumber` | NUMERIC(12,0) | **Номер стола** (используется в table_stack) |
| `ctlg13_ctlg12_uuid__hall` | UUID | FK → ctlg12_halls.suuid (зал) |
| `ctlg13_ctlg11_uuid__restaurant` | UUID | FK → ctlg11_restaurants.suuid |
| `ctlg13_seatsnumber` | NUMERIC(12,0) | Количество мест |

**Связь с модулем:** JOIN через `docm2_orders.docm2_ctlg13_uuid__halltable = ctlg13_halltables.suuid` для получения `ctlg13_tablenumber` → `Order.table_stack`.

---

## ctlg14_shifts

**Назначение:** Смены ресторана.

| Колонка | Тип | Описание |
|---|---|---|
| `suuid` | UUID | Бизнес-ключ смены |
| `name` | TEXT | Название |
| `ctlg14_shiftdate` | DATE | Дата смены |
| `ctlg14_opentime` | TIMESTAMP | Время открытия |
| `ctlg14_closetime` | TIMESTAMP | Время закрытия |
| `ctlg14_closed` | BOOLEAN | Закрыта ли смена |
| `ctlg14_ctlg11_uuid__restaurant` | UUID | FK → ресторан |

**Связь с модулем:** Фильтруем заказы по активной смене (`ctlg14_closed = false`).

---

## ctlg18_menuitems

**Назначение:** Меню ресторана — пункты которые заказываются. Связывает блюдо (`ctlg15_dishes`) со складом-цехом (`ctlg17_storages`). Используется модулем как **основной источник** для определения "кухонных" блюд в `GET /api/dishes`.

| Колонка | Тип | Описание |
|---|---|---|
| `suuid` | UUID | Бизнес-ключ пункта меню |
| `name` | TEXT | Название пункта |
| `isfolder` | BOOLEAN | Это папка (группировка) |
| `folder` | UUID | Родительская папка |
| `ctlg18_ctlg15_uuid__dish` | UUID | FK → `ctlg15_dishes.suuid` (блюдо) |
| `ctlg18_ctlg17_uuid__storage` | UUID | FK → `ctlg17_storages.suuid` (цех-склад) |
| `ctlg18_stoplist` | BOOLEAN | Локальный стоп-лист меню |
| `ctlg18_price` | NUMERIC | Цена |
| `ctlg18_quantity` | NUMERIC | Количество |
| `ctlg18_ctlg19_uuid__measure` | UUID | Единица измерения |
| `ctlg18_ctlg16_uuid__restaurantmenu` | UUID | FK → меню ресторана |
| `ctlg18_ctlg21_uuid__modset` | UUID | Набор модификаторов |
| `ctlg18_article` | TEXT | Артикул |
| `ctlg18_disabled` | BOOLEAN | Пункт отключён |
| `ctlg18_aggrprice` | NUMERIC | Агрегированная цена |

**Связь с модулем:** Позволяет новым блюдам **сразу** появляться в рецептах нарезчика — не дожидаясь первого заказа. Если блюдо привязано в меню к кухонному складу, оно автоматически попадает в `GET /api/dishes`.

**Пример запроса:**
```sql
SELECT DISTINCT mi.ctlg18_ctlg15_uuid__dish, d.name
FROM ctlg18_menuitems mi
JOIN ctlg15_dishes d ON d.suuid = mi.ctlg18_ctlg15_uuid__dish
WHERE mi.isfolder = false
  AND mi.ctlg18_ctlg17_uuid__storage = '49aeb05c-966b-4d42-bf80-595de514122a'
```

**Примечание по тестовому дампу:** Таблица в дампе почти пустая (5 блюд). В продакшне содержит полное меню ресторана.

---

## ctlg17_storages

**Назначение:** Справочник складов-цехов ресторана. Используется в модуле нарезчика как механизм разделения заказов по цехам: нарезчик видит только кухонный склад, всё остальное скрывается.

| Колонка | Тип | Описание |
|---|---|---|
| `suuid` | UUID | Бизнес-ключ склада |
| `code` | TEXT | Код склада (например, "kitchen") |
| `name` | TEXT | Название на русском |
| `isfolder` | BOOLEAN | Это папка |
| `folder` | UUID | Родительская папка |

**Реальные данные в базе ресторана Жарокова:**

| suuid | name | Действие |
|---|---|---|
| `49aeb05c-966b-4d42-bf80-595de514122a` | **Кухня Жарокова** | ✅ Whitelist — показывается нарезчику |
| `48dded95-9c6d-421e-9d7e-58e49a3e7889` | Бар Жарокова | ❌ Скрывается |
| `94cb93cc-0bf8-41ae-b255-131d91a15017` | Хоз. склад Жарокова | ❌ Скрывается |

**Битые ссылки на удалённые склады:** Часть позиций в `docm2tabl1_items` ссылаются на UUID, которых уже нет в `ctlg17_storages` (склады были удалены). Эти позиции **тоже скрываются** — будут исправлены вручную в БД позже.

**Связь с модулем:** Поле `docm2tabl1_items.docm2tabl1_ctlg17_uuid__storage` ссылается сюда. Модуль использует **whitelist-подход**: показываются только позиции с UUID из константы `KITCHEN_STORAGE_UUIDS`.

Константа определена в двух местах (синхронизированы):
- `server/src/routes/orders.ts` — фильтрация активных заказов в `GET /api/orders`
- `server/src/routes/dishes.ts` — фильтрация справочника блюд в `GET /api/dishes`

**Фильтрация в `GET /api/orders`:**
```sql
WHERE items.docm2tabl1_ctlg17_uuid__storage IN (
  '49aeb05c-966b-4d42-bf80-595de514122a'  -- Кухня Жарокова
)
```

**Фильтрация в `GET /api/dishes`:**
Блюдо попадает в список если **хотя бы одно** из условий выполнено:
```sql
-- Условие 1: блюдо есть в меню с кухонным складом (для новых блюд)
EXISTS (
  SELECT 1 FROM ctlg18_menuitems mi
  WHERE mi.ctlg18_ctlg15_uuid__dish = d.suuid
    AND mi.isfolder = false
    AND mi.ctlg18_ctlg17_uuid__storage IN (
      '49aeb05c-966b-4d42-bf80-595de514122a'
    )
)
-- Условие 2: блюдо хоть раз заказывалось с кухни (fallback)
OR EXISTS (
  SELECT 1 FROM docm2tabl1_items i
  WHERE i.docm2tabl1_ctlg15_uuid__dish = d.suuid
    AND i.docm2tabl1_ctlg17_uuid__storage IN (
      '49aeb05c-966b-4d42-bf80-595de514122a'
    )
)
```

**Почему два источника:**
- `ctlg18_menuitems` — меню ресторана. Новые блюда попадают сюда сразу после добавления, и так же сразу появляются в рецептах нарезчика.
- `docm2tabl1_items` — историческая выборка. Fallback для старых блюд которые ещё не перенесены в новое меню.

**Статистика на тестовых данных:**
- Всего активных позиций: 625 → **47** после фильтра
- Всего блюд в справочнике: 876 → **29** уникальных кухонных блюд

**При деплое на другой ресторан:** UUID в константе `KITCHEN_STORAGE_UUIDS` нужно обновить под конкретное значение из `ctlg17_storages` целевой БД. В будущем можно вынести в `slicer_settings` как JSONB массив для настройки через API.

---

## rgst3_dishstoplist

**Назначение:** Регистр стоп-листа блюд (основная KDS).

| Колонка | Тип | Описание |
|---|---|---|
| `suuid` | UUID | Бизнес-ключ записи |
| `rgst3_ctlg15_uuid__dish` | UUID | FK → ctlg15_dishes.suuid (блюдо на стопе) |
| `rgst3_ctlg11_uuid__restaurant` | UUID | FK → ресторан |
| `rgst3_ctlg14_uuid__shift` | UUID | FK → смена |
| `rgst3_ctlg16_uuid__restaurantmenu` | UUID | FK → меню |
| `rgst3_ctlg5_uuid__responsible` | UUID | FK → ответственный сотрудник |

**Связь с модулем:** Читаем для определения, какие блюда на стопе в основной системе. Дополняем своим стоп-листом ингредиентов (`slicer_ingredients.is_stopped`).
