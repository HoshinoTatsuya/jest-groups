import { findLastJson } from '../find-last-json';

/**
 * Выборка из вывода `vitest list --filesOnly --json`: массив `{ file,
 * projectName? }`. Файл, входящий в несколько проектов, приходит по записи на
 * проект — так и возвращается (число копий нужно сверке «выполнен дважды»).
 */
export const parseVitestListOutput = (stdout: string): string[] | null =>
  findLastJson(
    stdout,
    '[',
    (value): value is { file: string }[] =>
      Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'object' && item !== null && typeof (item as { file?: unknown }).file === 'string',
      ),
  )?.map((item) => item.file) ?? null;
