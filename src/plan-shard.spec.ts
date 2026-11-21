import { assignShard } from './assign-shard';
import { planGroups } from './plan-groups';

describe('planGroups: потолок длительности', () => {
  it('файлы, укладывающиеся по числу, но не по времени, — в разные группы', () => {
    const entries = [
      { file: 'slow-a', tests: 20, durationMs: 50_000 },
      { file: 'slow-b', tests: 20, durationMs: 50_000 },
      { file: 'fast', tests: 200, durationMs: 1_000 },
    ];
    // По числу все три — одна группа (240 ≤ 285).
    expect(planGroups(entries, 285)).toEqual([['fast', 'slow-a', 'slow-b']]);
    expect(planGroups(entries, 285, 60_000)).toEqual([['fast', 'slow-a'], ['slow-b']]);
  });

  it('ровно на потолке длительности — в группе; время не известно — не засчитывается', () => {
    expect(
      planGroups(
        [
          { file: 'a', tests: 1, durationMs: 30_000 },
          { file: 'b', tests: 1, durationMs: 30_000 },
          { file: 'c', tests: 1 },
        ],
        285,
        60_000,
      ),
    ).toEqual([['a', 'b', 'c']]);
  });
});

describe('assignShard: один план на все машины', () => {
  const entries = Array.from({ length: 23 }, (_, index) => ({
    file: `f${String(index).padStart(2, '0')}`,
    tests: 1 + ((index * 37) % 50),
  }));

  it('каждый файл — ровно в одном шарде, при любом числе шардов', () => {
    for (const count of [1, 2, 3, 5, 23]) {
      const all = Array.from({ length: count }, (_, shard) => assignShard(entries, shard + 1, count)).flat();
      expect({ count, files: [...all].sort() }).toEqual({
        count,
        files: entries.map((entry) => entry.file).sort(),
      });
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('не зависит от порядка входа (машины CI видят выборку в разном порядке)', () => {
    const reversed = [...entries].reverse();
    for (const shard of [1, 2, 3]) {
      expect(assignShard(reversed, shard, 3)).toEqual(assignShard(entries, shard, 3));
    }
  });

  it('нагрузка ровная: разница шардов не больше самого тяжёлого файла', () => {
    const weight = new Map(entries.map((entry) => [entry.file, entry.tests]));
    const loads = [1, 2, 3].map((shard) =>
      assignShard(entries, shard, 3).reduce((total, file) => total + (weight.get(file) ?? 0), 0),
    );
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(50);
  });

  it('шардов больше, чем файлов — лишние пусты', () => {
    expect(assignShard([{ file: 'a', tests: 1 }], 2, 2)).toEqual([]);
    expect(assignShard([{ file: 'a', tests: 1 }], 1, 2)).toEqual(['a']);
  });
});
