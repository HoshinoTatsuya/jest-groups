import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGACY_CACHE_FILE } from '../constants/legacy-cache-file.constant';
import type { CacheEntry } from '../types/cache-entry.type';
import type { TestCache } from '../types/test-cache.type';
import { isCacheEntry } from './is-cache-entry';

/**
 * Кэш команды. Кэш — подсказка плана: нечитаемый значит «истории нет», а не
 * отказ. Команды без своего кэша получают факты из кэша до 0.5.0 (`{файл:
 * число}`) с отпечатком, который не совпадёт ни с одним файлом: такой факт
 * идёт только как нижняя граница (большее из него и оценки по тексту).
 */
export const readTestCache = (dir: string, key: string, command: readonly string[]): TestCache => {
  const files: Record<string, CacheEntry> = {};
  try {
    const raw = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as { files?: unknown };
    for (const [file, entry] of Object.entries(raw.files ?? {})) {
      if (isCacheEntry(entry)) {
        files[file] = entry;
      }
    }
    return { version: 2, command, files };
  } catch {
    // своей истории нет — пробуем прежний общий кэш
  }
  try {
    const legacy = JSON.parse(readFileSync(join(dir, LEGACY_CACHE_FILE), 'utf8')) as Record<string, unknown>;
    for (const [file, tests] of Object.entries(legacy)) {
      if (Number.isInteger(tests) && (tests as number) > 0) {
        files[file] = { tests: tests as number, mtimeMs: -1, size: -1 };
      }
    }
  } catch {
    // и её нет
  }
  return { version: 2, command, files };
};
