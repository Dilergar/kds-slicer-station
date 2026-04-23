/**
 * Централизованный обработчик ошибок Express.
 * Ловит все ошибки из маршрутов и возвращает единообразный JSON-ответ.
 */
import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({
    error: 'Внутренняя ошибка сервера',
    message: err.message
  });
}
