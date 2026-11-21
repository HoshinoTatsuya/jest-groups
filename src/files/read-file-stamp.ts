import { statSync } from 'node:fs';

import type { FileStamp } from '../types/file-stamp.type';

/** Отпечаток файла для свежести кэша; файла нет — null. */
export const readFileStamp = (path: string): FileStamp | null => {
  try {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
};
