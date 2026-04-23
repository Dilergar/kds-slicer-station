# Миграция 009: slicer_ingredients.image_url — с Base64 на файлы на диске

## Дата выполнения
2026-04-19

## Файл
`server/migrations/009_ingredient_images_filesystem.sql`

## Что делает
1. Добавляет в `slicer_ingredients` две колонки: `image_content_type VARCHAR(50)`, `image_file_size INT` (для диагностики/мониторинга).
2. Очищает все Base64 data-URL: `UPDATE slicer_ingredients SET image_url = NULL WHERE image_url LIKE 'data:%'`.
3. Обновляет `COMMENT ON COLUMN` — теперь `image_url` описана как путь `/images/ingredients/<id>.<ext>`.

## Зачем понадобилась

До миграции `slicer_ingredients.image_url` хранил Base64 data-URL
(`data:image/jpeg;base64,…`) — до 230 КБ на одну запись в TEXT-колонке.
Те же минусы, что были у блюд до миграции 008:
- раздутый TEXT в БД,
- `GET /api/ingredients` везёт все картинки на каждом запросе,
- браузер не кэширует data-URL → каждая загрузка = полная перекачка,
- PostgreSQL TOAST-storage добавляет I/O на каждый SELECT.

Миграция делает для ингредиентов то же, что миграция 008 сделала для блюд.
Разница: у ингредиентов есть своя таблица `slicer_ingredients` с колонкой
`image_url`, поэтому **новая таблица не нужна** — переиспользуем колонку,
теперь там лежит путь (`/images/ingredients/<id>.<ext>`).

## Что изменилось в коде

1. **`server/migrations/009_ingredient_images_filesystem.sql`** — сама миграция.
2. **`server/src/routes/ingredients.ts`** — multer-конфиг (`UPLOAD_DIR_ING`), endpoints `POST /:id/image` и `DELETE /:id/image`. Те же правила что у блюд: 5 МБ лимит, whitelist jpeg/png/gif/webp, старое фото с другим расширением удаляется.
3. **`server/public/images/ingredients/`** — папка создаётся автоматически при старте backend.
4. **`services/ingredientImagesApi.ts`** — `uploadIngredientImage(id, file)` / `deleteIngredientImage(id)` (зеркало dishImagesApi).
5. **`components/StopListManager.tsx`** — `handleFileChange` теперь multipart-upload через API (раньше был FileReader → Base64 → PUT).
6. **`.gitignore`** — исключает `server/public/images/ingredients/*` (кроме `.gitkeep`).

## Затронутые колонки `slicer_ingredients`

| Колонка | Что было | Что стало |
|---|---|---|
| `image_url TEXT` | Base64 data-URL (`data:image/jpeg;base64,...`, до 230 КБ) | Относительный HTTP-путь (`/images/ingredients/<id>.jpg`, ~60 байт) |
| `image_content_type VARCHAR(50)` | не было | MIME, заполняется multer'ом |
| `image_file_size INT` | не было | Байты, заполняется multer'ом |

## Влияние на существующие данные

Очистка Base64 — **потеря содержимого** старых фото. В локальном dev-дампе
на момент миграции был один ингредиент с Base64 (Грибы) → очищен, нужно
перезалить через UI. Это приемлемо, потому что других ресторанов у нас
ещё нет — заказчик получит модуль уже с миграцией 009, Base64 там не
будет никогда.

Если у заказчика в своей БД окажется старое Base64 (например, миграция
применилась к БД где UI уже писал Base64) — содержимое будет потеряно,
UI покажет placeholder, пользователь перезагрузит фото.

## Откат

```sql
ALTER TABLE slicer_ingredients DROP COLUMN IF EXISTS image_content_type;
ALTER TABLE slicer_ingredients DROP COLUMN IF EXISTS image_file_size;
-- image_url оставляем (колонка существовала до 009).
-- + вручную удалите папку server/public/images/ingredients/ если больше не нужна.
```

Откат не восстановит Base64-содержимое, очищенное миграцией. Если это
критично — перед откатом снимите бэкап.

## Нюансы прода

- Симметрично `slicer_dish_images`: nginx `alias` раздаёт `public/images/`
  напрямую с диска.
- Папка `server/public/images/ingredients/` **не включается в pg_dump** —
  добавляйте её в свой бэкап отдельно.
- Express static-middleware в `server/src/index.ts` слушает `/images/*` —
  ingredients и dishes обслуживаются одним и тем же middleware, разделение
  по подпапкам.
