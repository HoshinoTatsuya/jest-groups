import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Запись через временный файл и rename: прерванная запись (SIGKILL, полный
 * диск) оставляла обрезанный JSON, и следующий прогон тихо терял всю историю
 * кэша — группы снова планировались по оценке. rename в пределах каталога
 * атомарен: на диске либо старый файл, либо новый целиком. Каталог создаётся
 * (артефакты CI): иначе весь прогон прошёл бы, а запись упала бы ENOENT.
 */
export const writeAtomically = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
};
