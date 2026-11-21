import type { CacheEntry } from '../types/cache-entry.type';
import type { FileStamp } from '../types/file-stamp.type';

/** Факт кэша свеж: отпечаток файла тот же, что был перед прогоном, давшим факт. */
export const isFresh = (entry: CacheEntry | undefined, stamp: FileStamp | null): boolean =>
  entry !== undefined && stamp !== null && entry.mtimeMs === stamp.mtimeMs && entry.size === stamp.size;
