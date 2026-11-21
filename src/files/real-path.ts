import { realpathSync } from 'node:fs';

/**
 * Пути — настоящие: каталог через симлинк (/var → /private/var на macOS) дал
 * бы относительные пути вида ../../.. и чужие ключи кэша.
 */
export const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
