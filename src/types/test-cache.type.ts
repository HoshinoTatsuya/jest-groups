import type { CacheEntry } from './cache-entry.type';

/** Кэш одной команды выборки: файл → факт. */
export interface TestCache {
  readonly version: 2;
  /** Команда выборки, для которой кэш записан, — для разбора, не для сверки. */
  readonly command: readonly string[];
  readonly files: Record<string, CacheEntry>;
}
