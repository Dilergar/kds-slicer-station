/**
 * utils/imageUpload.ts — Общие правила приёма фото (блюда и ингредиенты).
 *
 * Зачем вынесено отдельно: правила должны быть одинаковыми в обоих загрузчиках,
 * а раньше каждый роут описывал их у себя, и оба содержали одну и ту же дыру.
 *
 * ЧТО БЫЛО НЕ ТАК. Комментарий рядом с фильтром обещал, что он «отсекает попытки
 * залить exe/html/svg под видом изображения». На деле проверялся `file.mimetype`,
 * который multer берёт из заголовка Content-Type в multipart-части, а расширение
 * файла на диске бралось из `file.originalname` — оба значения полностью под
 * контролем отправителя. Файл с именем `x.html` и заголовком `image/png`
 * проходил фильтр, сохранялся как `.html` в папку статики и отдавался браузером
 * как HTML: исполняемый скрипт на том же origin, что и приложение. То же с `.svg`
 * со встроенным кодом.
 *
 * ЧТО СТАЛО. Расширение выводится из белого списка по проверенному типу, имя
 * файла на диске собирается только из uuid и метки времени, а содержимое
 * дополнительно сверяется с сигнатурой формата (magic bytes) после записи.
 */

import fs from 'fs';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';

/** Разрешённые типы и соответствующие им расширения на диске */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * Расширение файла для проверенного MIME-типа.
 * @param mimetype — тип из multipart-части (уже прошедший imageFileFilter)
 * @returns расширение с точкой, по умолчанию .jpg
 */
export function extensionForMime(mimetype: string): string {
  return ALLOWED_IMAGE_TYPES[mimetype] ?? '.jpg';
}

/**
 * Фильтр multer: пропускаем только заявленные форматы картинок.
 * Это лишь первая проверка — содержимое сверяется отдельно (см. verifyImageSignature).
 */
export function imageFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, file.mimetype)) {
    cb(null, true);
  } else {
    const err: NodeJS.ErrnoException = new Error('Неподдерживаемый формат файла (только JPEG/PNG/GIF/WEBP)');
    // Код разбирает errorHandler, чтобы ответить 400 вместо 500
    err.code = 'UNSUPPORTED_IMAGE_TYPE';
    cb(err);
  }
}

/**
 * Проверяет, что содержимое файла действительно картинка заявленного семейства.
 *
 * Сверяем «магические байты» — их подделать одним заголовком нельзя.
 * Вызывается ПОСЛЕ записи файла на диск (multer пишет потоково), поэтому
 * при провале вызывающий обязан удалить файл.
 *
 * @param filePath — путь к сохранённому файлу
 * @returns true, если сигнатура соответствует JPEG/PNG/GIF/WEBP
 */
export function verifyImageSignature(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, head, 0, 12, 0);
    if (bytesRead < 4) return false;

    // JPEG: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
    // GIF: "GIF87a" / "GIF89a"
    if (head.slice(0, 6).toString('ascii') === 'GIF87a' || head.slice(0, 6).toString('ascii') === 'GIF89a') return true;
    // WEBP: "RIFF" .... "WEBP"
    if (head.slice(0, 4).toString('ascii') === 'RIFF' && head.slice(8, 12).toString('ascii') === 'WEBP') return true;

    return false;
  } catch {
    // Не смогли прочитать — считаем непроверенным и не пропускаем
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* уже закрыт */ }
    }
  }
}
