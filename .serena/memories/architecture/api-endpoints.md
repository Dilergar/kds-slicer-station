# REST API эндпоинты (backend port 3001)

Все маршруты в `server/src/routes/`. Подключаются в `server/src/index.ts`.

## Orders (`routes/orders.ts`)
- `GET /api/orders` — активные заказы (polling 4с). JOIN docm2_orders + docm2tabl1_items + ctlg15_dishes + ctlg13_halltables + slicer_order_state + **slicer_dish_aliases** (резолв алиасов, подмена dish_id на primary). Whitelist по Кухне через storage. Авто-разпарковка перед выборкой.
- `POST /api/orders/:id/complete` — завершить. INSERT/UPDATE slicer_order_state (status='COMPLETED', finished_at=NOW()), INSERT в slicer_order_history + slicer_ingredient_consumption. `docm2tabl1_cooked`/`docm2tabl1_cooktime` НЕ трогаем (убрано в миграции 007, 2026-04-18, чтобы не путать панели раздачи/пасса).
- `POST /api/orders/:id/partial-complete` — частичное завершение (quantityToComplete).
- `POST /api/orders/:id/cancel` — отмена (UPDATE status='CANCELLED').
- `POST /api/orders/:id/restore` — возврат из истории. UPSERT slicer_order_state: status='ACTIVE', quantity_stack/table_stack из body, finished_at=NULL, parked_at=NULL. Body: `{quantityStack, tableStack}` — финальные значения, считает фронт (snapshot + остаток если уже был partial). Без этого endpoint'а оптимистичное восстановление перетиралось polling'ом — старый TODO в useOrders.handleRestoreOrder.
- `POST /api/orders/:id/park` — парковка (body: quantityStack, tableStack, parkedTables, unparkAt, accumulatedTimeMs).
- `POST /api/orders/:id/unpark` — снять с парковки.
- `POST /api/orders/:id/merge` — объединить стеки.

## Dishes (`routes/dishes.ts`)
- `GET /api/dishes` — список блюд из `ctlg15_dishes`. Источники: `ctlg18_menuitems` (меню ресторана) OR `docm2tabl1_items` (история). Whitelist по кухонному складу. JOIN с **slicer_dish_aliases** для резолва `recipe_source_id` (ингредиенты берутся от primary блюда если это алиас). Категории собираются из **slicer_dish_categories** через `array_agg(category_id)` — блюда без ручного назначения возвращают `category_ids: []`. Возвращает `code`, `recipe_source_id`.
- `PUT /api/dishes/:dishId/categories` — полная замена ручного назначения категорий. Body: `{category_ids: string[]}`. Транзакция DELETE+INSERT в `slicer_dish_categories`. Вызывается из `RecipeEditor.saveDishForm`.

## Dish Aliases (`routes/dishAliases.ts`)
- `GET /api/dish-aliases` — список всех алиасов
- `POST /api/dish-aliases` — UPSERT в транзакции + автокопия category_ids primary → alias через `slicer_dish_categories` (чтобы alias-блюдо автоматически попадало в тот же блок очереди). Body: `{alias_dish_id, primary_dish_id}`. Ограничение: одно блюдо = один рецепт (PK на alias_dish_id).
- `DELETE /api/dish-aliases/:alias_dish_id` — отвязать алиас, блюдо становится independent

## Ingredients (`routes/ingredients.ts`)
CRUD для slicer_ingredients. Стоп-лист управляется через /api/stoplist/toggle.
- `GET /api/ingredients`, `POST`, `PUT /:id`, `DELETE /:id` (каскадно удаляет children)

## Categories (`routes/categories.ts`)
CRUD для slicer_categories.
- `GET`, `POST`, `PUT /:id`, `DELETE /:id`, `PUT /reorder`

## Settings (`routes/settings.ts`)
- `GET /api/settings` — все настройки (singleton)
- `PUT /api/settings` — partial update

## Stoplist (`routes/stoplist.ts`)
- `POST /api/stoplist/toggle` — переключить. Body: `{targetId, targetType: 'ingredient'|'dish', reason}`.
- `GET /api/stoplist/history?from=&to=` — история с фильтром по дате

## Recipes (`routes/recipes.ts`)
- `GET /api/recipes/:dishId` — ингредиенты рецепта с JOIN на slicer_ingredients
- `PUT /api/recipes/:dishId` — полная замена. Body: `{ingredients: [{ingredientId, quantity}]}`. Вызывается из `RecipeEditor.saveDishForm`; для alias-блюда фронт резолвит dishId в primary через `aliasMap` перед отправкой.

## Dish images (`routes/dishes.ts`, миграция 008, 2026-04-19)
- `POST /api/dishes/:dishId/image` — multipart/form-data, поле `image`. Multer diskStorage → `server/public/images/dishes/<dishId>.<ext>`, старое фото с другим расширением удаляется. INSERT ON CONFLICT в `slicer_dish_images` (dish_id, image_path, content_type, file_size). Лимит 5МБ, whitelist `image/jpeg|png|gif|webp`.
- `DELETE /api/dishes/:dishId/image` — идемпотентный. fs.unlinkSync + DELETE row.
- `GET /api/dishes` делает `LEFT JOIN slicer_dish_images` и возвращает `image_url: imagesByDish.get(id) || ''` (вместо захардкоженной пустой строки). Раздача файлов: `app.use('/images', express.static(..., {maxAge: '7d'}))` в `server/src/index.ts`, Vite proxy `/images` → 3001. В проде nginx alias напрямую с диска. Frontend: `services/dishImagesApi.ts` (uploadDishImage/deleteDishImage), RecipeEditor держит `pendingImageFile: File | null` + `imageMarkedForRemoval: boolean`, вызывает после `updateRecipe`.

## Ingredient images (`routes/ingredients.ts`, миграция 009, 2026-04-19)
- `POST /api/ingredients/:id/image` — то же что у блюд, но файл → `server/public/images/ingredients/<id>.<ext>`, UPDATE slicer_ingredients SET image_url + image_content_type + image_file_size.
- `DELETE /api/ingredients/:id/image` — fs.unlinkSync + UPDATE ... SET image_url=NULL.
- Отдельной таблицы нет — колонка `image_url` в `slicer_ingredients` переиспользуется. Миграция 009 очистила Base64 data-URL (`WHERE image_url LIKE 'data:%'`). Frontend: `services/ingredientImagesApi.ts`, `components/StopListManager.tsx` `handleFileChange` делает multipart upload через `uploadIngredientImage(id, file)` + `onUpdateIngredient({imageUrl})` для локального state.

## History (`routes/history.ts`)
- `GET /api/history/orders?from=&to=`
- `DELETE /api/history/orders/:id`
- `GET /api/history/dashboard/speed-kpi?from=&to=` — KPI скорости нарезчика (агрегация по dish/was_parked на SQL)
- `GET /api/history/dashboard/chef-cooking-speed?from=&to=` — метрика «Скорость готовки повара». JOIN slicer_order_state → docm2tabl1_items + резолв алиасов. Возвращает сырые пары `{orderItemId, dishId, dishName, quantity, finishedAt, cookTimeMs}`, cookTimeMs = `docm2tabl1_cooktime - finished_at`. Агрегация по категории/блюду на клиенте (ChefCookingSpeedSection), как в SpeedKpiSection.
- `GET /api/history/dashboard/ingredient-usage?from=&to=`

## Stop-list history (`routes/stoplist.ts`)
- `POST /api/stoplist/toggle` — переключить стоп ингредиента или блюда. Пишет slicer_stop_history при снятии + вызывает recalculateCascadeStops.
- `GET /api/stoplist/history?from=&to=` — **UNION двух источников** + фильтр по пересечению интервалов:
  1. `slicer_stop_history` — наши стопы + захваченные триггером миграции 011 (DELETE rgst3 кассиром).
  2. `rgst3_dishstoplist` архив закрытых смен — стопы дожившие до конца смены. `resumed_at = ctlg14_closetime`. id префикс `rgst3_archive_<suuid>` для уникальности React-ключей.
  Пересечений между источниками быть не должно (slicer_stop_history = удалённые, rgst3 архив = живые в закрытых сменах), UNION ALL безопасен.
- `recalculateCascadeStops` пишет в slicer_stop_history с `target_name` = реальное имя блюда из `ctlg15_dishes` (через LEFT JOIN при чтении existingCascade). До 2026-04-19 там по ошибке писалось `reason` ("Missing: X"), из-за чего cascade-записи в Dashboard выглядели как блюда с именем ингредиента.
- **Триггер архивации** `slicer_archive_rgst3_delete()` (миграция 011): BEFORE DELETE ON rgst3_dishstoplist копирует OLD row в slicer_stop_history. Защита от дубликатов при двусторонней синхронизации — пропускает DELETE где `OLD.inserter = slicer_kds_sync_config.inserter_text`.

## Health
- `GET /api/health`

## Frontend services/ соответствие
Каждому backend route соответствует файл в `services/`:
- orders.ts → ordersApi.ts
- dishes.ts → dishesApi.ts
- **dishAliases.ts → dishAliasesApi.ts** (NEW)
- ingredients.ts → ingredientsApi.ts
- categories.ts → categoriesApi.ts
- settings.ts → settingsApi.ts
- stoplist.ts → stoplistApi.ts
- recipes.ts → recipesApi.ts
- history.ts (/dashboard/chef-cooking-speed) → chefCookingApi.ts (`fetchChefCookingEntries(from,to)`) — грузится напрямую в Dashboard.tsx через useEffect при applied filter
- dishes.ts (POST/DELETE /:dishId/image) → dishImagesApi.ts (`uploadDishImage(dishId, file)` / `deleteDishImage(dishId)`). multipart через FormData — НЕ через client.ts (fetch сам ставит Content-Type с boundary).
- ingredients.ts (POST/DELETE /:id/image) → ingredientImagesApi.ts — аналогично dishImagesApi, тоже multipart.
Все остальные используют базовый fetch wrapper из `services/client.ts`.
