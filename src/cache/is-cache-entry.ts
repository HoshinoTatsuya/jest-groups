import type { CacheEntry } from '../types/cache-entry.type';

/** Запись кэша той формы, которую пишет раннер; иное — «истории нет», а не отказ. */
export const isCacheEntry = (value: unknown): value is CacheEntry => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { tests, mtimeMs, size, durationMs, estimate, estimator } = value as Record<string, unknown>;
  return (
    Number.isInteger(tests) &&
    (tests as number) > 0 &&
    typeof mtimeMs === 'number' &&
    Number.isFinite(mtimeMs) &&
    Number.isInteger(size) &&
    (durationMs === undefined || (typeof durationMs === 'number' && durationMs >= 0)) &&
    (estimate === undefined || (Number.isInteger(estimate) && (estimate as number) > 0)) &&
    (estimator === undefined || estimator === 'ast' || estimator === 'regex')
  );
};
