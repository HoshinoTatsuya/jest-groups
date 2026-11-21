import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeAtomically } from '../files/write-atomically';
import type { TestCache } from '../types/test-cache.type';

/**
 * Запись кэша команды. Записи файлов, которых больше нет на диске, снимаются:
 * прежде кэш копил удалённые и переименованные спеки бессрочно. Файлы, которые
 * есть, но не попали в этот прогон (узкая выборка), остаются — их факты верны.
 */
export const writeTestCache = (dir: string, key: string, cache: TestCache, root: string): void => {
  const files = Object.fromEntries(
    Object.entries(cache.files)
      .filter(([file]) => existsSync(join(root, file)))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  writeAtomically(join(dir, `${key}.json`), `${JSON.stringify({ ...cache, files }, null, 1)}\n`);
};
