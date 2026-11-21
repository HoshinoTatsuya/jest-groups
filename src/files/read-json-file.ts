import { readFileSync } from 'node:fs';

import { JSON_FILE_READ } from '../constants/json-file-read.constant';
import type { JsonFileRead } from '../types/json-file-read.type';

/**
 * Отчёт или покрытие группы. Прежде любой отказ чтения читался как «jest не
 * записал отчёт», и обрезанный файл (jest убит посреди записи, полный диск)
 * отправлял искать, почему jest не дошёл до отчёта, хотя он дошёл. Объект JSON
 * обязателен: `null` или число на месте отчёта — тоже «не тот файл».
 */
export const readJsonFile = <T>(path: string): JsonFileRead<T> => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: JSON_FILE_READ.missing };
    }
    return { kind: JSON_FILE_READ.invalid, reason: `не прочитан: ${String(error)}` };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { kind: JSON_FILE_READ.invalid, reason: `JSON, но не объект (${text.length} байт)` };
    }
    return { kind: JSON_FILE_READ.ok, value: value as T };
  } catch (error) {
    return {
      kind: JSON_FILE_READ.invalid,
      reason: `не JSON — обрезан? (${text.length} байт: ${error instanceof Error ? error.message : String(error)})`,
    };
  }
};
