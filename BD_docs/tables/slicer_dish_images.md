# slicer_dish_images

## Назначение
Хранит путь до загруженной картинки блюда. Сами файлы лежат на диске в
`server/public/images/dishes/<dish_id>.<ext>`. Отдельная таблица — потому
что блюда живут в чужой `ctlg15_dishes`, куда модуль не пишет.

Почему не Base64 в TEXT (как у `slicer_ingredients.image_url`):
- Размер: 200KB–2MB на одно блюдо в TEXT-колонке.
- `GET /api/dishes` с JOIN на картинки раздувается на 140MB+ при 700 блюдах.
- Браузер не кэширует data-URL — картинка перекачивается при каждом запросе.
- TOAST-storage PostgreSQL добавляет I/O на каждый SELECT.

Отдельный файл на диске + путь в БД решает все четыре проблемы.

## Метод связывания
`dish_id` содержит `ctlg15_dishes.suuid` — чужая таблица, **не FK**, а
текстовая ссылка. При `GET /api/dishes` делается `LEFT JOIN
slicer_dish_images` по dish_id → в ответе `image_url = image_path` или
пустая строка если записи нет.

При алиасах запись пишется на конкретный `dish_id` (не на primary) —
чтобы варианты блюда (зал/доставка) могли иметь разные фото, если
нарезчик хочет.

## Колонки

| Колонка | Тип | NOT NULL | DEFAULT | Описание |
|---|---|---|---|---|
| `dish_id` | VARCHAR(255) | ✅ | — | **PK**. UUID блюда из `ctlg15_dishes.suuid` |
| `image_path` | TEXT | ✅ | — | Относительный URL: `/images/dishes/<uuid>.<ext>` |
| `content_type` | VARCHAR(50) | ❌ | `NULL` | MIME-тип: `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| `file_size` | INT | ❌ | `NULL` | Размер файла в байтах (для мониторинга) |
| `updated_at` | TIMESTAMPTZ | ✅ | `NOW()` | Когда обновили |

## Индексы
Нет индексов помимо PK — выборка идёт всегда по `dish_id` (UNIQUE PK).

## Допустимые расширения
Multer-фильтр на backend принимает только `image/jpeg`, `image/png`,
`image/gif`, `image/webp`. Остальные mimetype отклоняются с 400.

Лимит размера: **5 МБ**. Синхронизирован с валидацией на фронтенде
(`RecipeEditor.handleFileChange`).

## Жизненный цикл файла

1. **Upload.** `POST /api/dishes/:dishId/image` с `multipart/form-data`, поле `image`.
   - Multer сохраняет в `server/public/images/dishes/<dishId>.<ext>`.
   - Если у блюда уже было фото с другим расширением — старый файл
     удаляется с диска (защита от мусора).
   - `INSERT ... ON CONFLICT DO UPDATE` записывает путь в БД.
2. **Чтение.** `GET /api/dishes` → `LEFT JOIN slicer_dish_images` →
   `image_url: "/images/dishes/<uuid>.jpg"`.
3. **Отдача файла.** В dev: Express static из `server/public/images/`.
   В проде: nginx `alias /opt/.../server/public/images/`.
4. **Delete.** `DELETE /api/dishes/:dishId/image` — удаляет файл с диска
   + удаляет строку в БД. Идемпотентный (вернёт `deleted:false` если не было).

## Бэкап
Папка `server/public/images/dishes/` не попадает в `pg_dump`. Если нужен
полный бэкап — включайте её отдельно (rsync, borg). Без неё при
восстановлении БД пути в `image_path` будут указывать на несуществующие
файлы, и картинки пропадут (Express вернёт 404).

## Пример запросов

```sql
-- Все блюда с фото
SELECT dish_id, image_path, file_size / 1024 AS kb FROM slicer_dish_images
 ORDER BY updated_at DESC LIMIT 10;

-- Общий объём хранилища картинок
SELECT pg_size_pretty(SUM(file_size)::bigint) AS total FROM slicer_dish_images;

-- Ручное удаление (+ надо почистить файл с диска отдельно)
DELETE FROM slicer_dish_images WHERE dish_id = '<uuid>';
```
