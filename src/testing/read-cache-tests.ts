import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cacheKey } from '../cache/cache-key';
import { CACHE_DIR_SEGMENTS } from '../constants/cache-file.constant';

/** Факты кэша команды `command` в проекте `root`: файл → число тестов (нет кэша — пусто). */
export const readCacheTests = (root: string, command: readonly string[]): Record<string, number> => {
  try {
    const cache = JSON.parse(
      readFileSync(join(root, ...CACHE_DIR_SEGMENTS, `${cacheKey('jest', command)}.json`), 'utf8'),
    ) as { files: Record<string, { tests: number }> };
    return Object.fromEntries(Object.entries(cache.files).map(([file, entry]) => [file, entry.tests]));
  } catch {
    return {};
  }
};
