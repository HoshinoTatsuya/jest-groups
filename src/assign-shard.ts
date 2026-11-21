import type { TestEntry } from './types/test-entry.type';

/**
 * Файлы шарда `index` из `count` (с 1). План обязан быть ОДИН на все машины
 * CI, поэтому делится по оценке из текста (одинаковой при одинаковом checkout
 * и версии TypeScript), а не по кэшу: кэш у каждой машины свой, и раскладка по
 * нему отдала бы файл двум шардам или ни одному. Жадно по убыванию веса в
 * наименее загруженный шард, при равенстве — по имени и по номеру шарда.
 * Внутри шарда группы планируются обычным порядком (по кэшу машины).
 */
export const assignShard = (entries: readonly TestEntry[], index: number, count: number): string[] => {
  const ordered = [...entries].sort(
    (left, right) =>
      right.tests - left.tests || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  );
  const loads = Array.from({ length: count }, () => 0);
  const shards: string[][] = Array.from({ length: count }, () => []);
  for (const { file, tests } of ordered) {
    let lightest = 0;
    for (let shard = 1; shard < count; shard++) {
      if ((loads[shard] ?? 0) < (loads[lightest] ?? 0)) {
        lightest = shard;
      }
    }
    loads[lightest] = (loads[lightest] ?? 0) + tests;
    shards[lightest]?.push(file);
  }
  return (shards[index - 1] ?? []).sort();
};
