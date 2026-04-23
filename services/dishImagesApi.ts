/**
 * API-клиент для загрузки/удаления фото блюд.
 *
 * Файл физически сохраняется на backend в server/public/images/dishes/,
 * в БД пишется только относительный URL (/images/dishes/<id>.<ext>).
 * В dev Vite проксирует /images → backend, в проде nginx раздаёт напрямую.
 */

const BASE_URL = '/api';

/**
 * Загружает файл-картинку на сервер для указанного блюда.
 * multipart/form-data с полем `image`. Заголовок Content-Type выставит
 * сам fetch с правильным boundary — поэтому не используем apiFetch.
 * @returns относительный URL сохранённой картинки
 */
export async function uploadDishImage(dishId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`${BASE_URL}/dishes/${dishId}/image`, {
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
 * Удаляет фото блюда (и файл с диска, и запись в slicer_dish_images).
 * Идемпотентный: вернёт OK даже если фото не было.
 */
export async function deleteDishImage(dishId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/dishes/${dishId}/image`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
}
