# Миграция 008: slicer_dish_images

## Дата выполнения
2026-04-19

## Файл
`server/migrations/008_dish_images.sql`

## Что делает
Создаёт одну новую таблицу `slicer_dish_images` (без индексов — PK уже
UNIQUE и достаточно).

## Зачем понадобилась

UI «Рецепты» позволял загружать фото блюда, но фича была недоделана:
- Фронт читал файл в Base64 через FileReader → Data URL.
- На сохранении ничего не отправлялось на backend.
- В `GET /api/dishes` поле `image_url` было захардкожено пустой строкой.
- Превью пропадало сразу после сохранения.

Решение сделано по схеме «файлы на диске, в БД только путь» — потому
что:
- Для 700+ блюд Base64 в TEXT превратил бы `/api/dishes` в сотни МБ.
- Data URL не кэшируется браузером → каждый refresh тянул бы всё заново.
- PostgreSQL TOAST на больших TEXT полях добавляет лишний I/O.

У ингредиентов пока осталась старая схема (Base64 в
`slicer_ingredients.image_url`) — их мало, критическая масса не набрана.
При желании можно в будущем сделать аналогичный рефакторинг миграцией 009.

## Что изменилось в коде

1. **`server/migrations/008_dish_images.sql`** — создание таблицы.
2. **`server/package.json`** — добавлены зависимости `multer` + `@types/multer`.
3. **`server/src/index.ts`** — подключение Express static для `/images/*` из `server/public/images/`.
4. **`server/src/routes/dishes.ts`** — multer-конфиг, endpoints `POST /:dishId/image` и `DELETE /:dishId/image`, LEFT JOIN `slicer_dish_images` в `GET /` (вместо захардкоженного `image_url: ''`).
5. **`vite.config.ts`** — проксирование `/images` → `localhost:3001` в dev.
6. **`services/dishImagesApi.ts`** — `uploadDishImage(dishId, file)`, `deleteDishImage(dishId)`.
7. **`components/admin/RecipeEditor.tsx`** — state `pendingImageFile` + `imageMarkedForRemoval`; после `updateRecipe` вызов `uploadDishImage` или `deleteDishImage`.
8. **`.gitignore`** — `server/public/images/dishes/*` чтобы пользовательский контент не попадал в git.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `dish_id` | VARCHAR(255) | ✅ | — | PK. `ctlg15_dishes.suuid` (чужая таблица, без FK) |
| `image_path` | TEXT | ✅ | — | Относительный URL: `/images/dishes/<uuid>.<ext>` |
| `content_type` | VARCHAR(50) | ❌ | NULL | MIME тип, для диагностики |
| `file_size` | INT | ❌ | NULL | Байты, для мониторинга |
| `updated_at` | TIMESTAMPTZ | ✅ | NOW() | Момент последней правки |

## Откат

```sql
DROP TABLE IF EXISTS slicer_dish_images;
```

Плюс вручную удалить папку `server/public/images/dishes/` (если больше
не нужна; pg_dump её всё равно не включает).

Откатить эту миграцию можно независимо от остальных — она изолирована,
зависимостей между 008 и 007/006 нет.

## Нюансы прода

- nginx должен отдавать `server/public/images/` напрямую с диска (см.
  `Инструкция.md` раздел «Запуск»). Проксирование через Node работает,
  но медленнее.
- Папка с картинками **не попадает в `pg_dump`** — включайте её в свой
  бэкап-скрипт отдельно.
- При переезде на другой сервер перенесите и БД, и папку. Пути в
  `image_path` — относительные (`/images/dishes/...`), так что ребазы на
  другой hostname не нужны.
