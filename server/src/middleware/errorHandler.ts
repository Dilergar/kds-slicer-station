/**
 * Централизованный обработчик ошибок Express.
 * Ловит все ошибки из маршрутов и возвращает единообразный JSON-ответ.
 *
 * Что было не так раньше. Статус был жёстко 500, а наружу отдавался `err.message`.
 * Из-за `fallthrough: false` на статике (index.ts) каждое отсутствующее фото
 * блюда давало 500 и полный стектрейс в лог вместо тихой 404 — на кухне с
 * удалёнными фото это шум на каждый запрос. Туда же уходили ошибки multer:
 * заведующая грузила .heic с айфона и видела «Внутренняя ошибка сервера»,
 * то есть думала, что сломался модуль, а не формат файла. Плюс текст исключения
 * из pg мог уехать клиенту, если бы какой-то роут забыл собственный catch.
 */
import { Request, Response, NextFunction } from 'express';

/** Ошибка с необязательными полями, которые расставляют express/multer/наш код */
interface HttpishError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Определяет HTTP-статус по ошибке.
 * @param err — пойманное исключение
 * @returns статус ответа
 */
function resolveStatus(err: HttpishError): number {
  // Явно проставленный статус (express.static кладёт 404 сюда)
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;

  // Ошибки multer и нашего fileFilter — это всегда вина запроса, а не сервера
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_FIELD_COUNT':
    case 'UNSUPPORTED_IMAGE_TYPE':
      return 400;
    case 'ENOENT':
      return 404;
    default:
      return 500;
  }
}

/**
 * Человеческий текст для клиента. Внутренности наружу не отдаём —
 * кроме понятных ошибок запроса, где текст и есть подсказка пользователю.
 * @param err — пойманное исключение
 * @param status — уже вычисленный статус
 */
function resolveMessage(err: HttpishError, status: number): string {
  if (status === 404) return 'Не найдено';
  if (err.code === 'LIMIT_FILE_SIZE') return 'Файл слишком большой (максимум 5 МБ)';
  if (status === 400) return err.message || 'Некорректный запрос';
  return 'Внутренняя ошибка сервера';
}

export function errorHandler(err: HttpishError, req: Request, res: Response, _next: NextFunction): void {
  const status = resolveStatus(err);

  // 404 по статике — обычное дело (удалили фото), стектрейс тут только шумит
  if (status === 404) {
    console.warn('[404]', req.method, req.originalUrl);
  } else if (status === 400) {
    console.warn('[400]', req.method, req.originalUrl, err.message);
  } else {
    console.error('[ERROR]', err.message, err.stack);
  }

  if (res.headersSent) return;

  res.status(status).json({ error: resolveMessage(err, status) });
}
