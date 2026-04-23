/**
 * API-клиент для фото ингредиентов.
 *
 * С миграции 009 фото хранится как файл в server/public/images/ingredients/,
 * путь — в slicer_ingredients.image_url. Раньше там был Base64 (до 230 КБ
 * на одну запись в TEXT), теперь ~50 байт пути. См. BD_docs/migrations/009_…md.
 *
 * Зеркалит services/dishImagesApi.ts.
 */

const BASE_URL = '/api';

/**
 * Загружает картинку ингредиента. multipart/form-data, поле `image`.
 * Content-Type с boundary ставит сам fetch — не используем apiFetch.
 * @returns относительный URL сохранённой картинки (/images/ingredients/<id>.<ext>)
 */
export async function uploadIngredientImage(ingredientId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`${BASE_URL}/ingredients/${ingredientId}/image`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.image_url as string;
}

/**
 * Удаляет фото ингредиента (файл с диска + image_url в БД).
 * Идемпотентный — OK даже если фото не было.
 */
export async function deleteIngredientImage(ingredientId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/ingredients/${ingredientId}/image`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
}
