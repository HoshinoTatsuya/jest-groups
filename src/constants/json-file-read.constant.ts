import { deepFreeze } from '../deep-freeze';

/** Исход чтения файла, который пишет jest: «файла нет» и «файл не JSON» лечатся по-разному. */
export const JSON_FILE_READ = { missing: 'missing', invalid: 'invalid', ok: 'ok' } as const;

deepFreeze(JSON_FILE_READ);
