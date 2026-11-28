import { JestGroupsError } from './jest-groups.error';
import { mergeShardReports } from './merge-shard-reports';
import type { JestReport } from './types/jest-report.type';
import type { ReportMeta } from './types/report-meta.type';

/** Отчёт шарда в форме, которую пишет раннер: тесты по файлу, пометка шарда с планом и файлами. */
const shard = (
  index: number,
  count: number,
  files: string[],
  meta: Partial<ReportMeta> = {},
): { path: string; report: JestReport } => ({
  path: `shard-${index}.json`,
  report: {
    success: true,
    numTotalTests: files.length,
    numPassedTests: files.length,
    numTotalTestSuites: files.length,
    testResults: files.map((file) => ({
      name: `/repo/${file}`,
      assertionResults: [{ status: 'passed', fullName: file }],
    })),
    jestGroups: {
      tool: 'jest',
      groups: 1,
      partial: `shard ${index}/${count}`,
      shard: `${index}/${count}`,
      plan: 'p1',
      files,
      ...meta,
    },
  } as JestReport,
});

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(JestGroupsError);
    return (error as JestGroupsError).message;
  }
  throw new Error('склейка не отказала');
};

describe('mergeShardReports', () => {
  it('все шарды одной раскладки — отчёт всего набора: не частичный, тесты и группы сложены', () => {
    const merged = mergeShardReports([shard(2, 2, ['b.spec.ts']), shard(1, 2, ['a.spec.ts', 'c.spec.ts'])]);
    expect(merged.jestGroups).toEqual({ tool: 'jest', groups: 2, shards: 2 });
    expect(merged.numTotalTests).toBe(3);
    // Порядок отчётов — по номеру шарда, а не по порядку аргументов.
    expect((merged.testResults ?? []).map((suite) => suite.name)).toEqual([
      '/repo/a.spec.ts',
      '/repo/c.spec.ts',
      '/repo/b.spec.ts',
    ]);
  });

  it('нет шарда — отказ с его номером: пропавшая машина CI не выглядит чистым прогоном', () => {
    expect(
      refusal(() => mergeShardReports([shard(1, 3, ['a.spec.ts']), shard(3, 3, ['c.spec.ts'])])),
    ).toContain('нет отчётов шардов 2/3');
  });

  it('шард дважды — отказ', () => {
    expect(
      refusal(() =>
        mergeShardReports([
          shard(1, 2, ['a.spec.ts']),
          shard(1, 2, ['a.spec.ts']),
          shard(2, 2, ['b.spec.ts']),
        ]),
      ),
    ).toContain('шард задан дважды: 1/2');
  });

  it.each([
    ['другой план', { plan: 'p2' }, 'план p2 ≠ p1'],
    ['другой инструмент', { tool: 'vitest' }, 'инструмент vitest ≠ jest'],
    ['другие причины частичности', { partial: 'changed-since main, shard 2/2' }, 'причины частичности'],
  ])('%s — шарды разных прогонов, отказ', (_, meta, message) => {
    expect(
      refusal(() => mergeShardReports([shard(1, 2, ['a.spec.ts']), shard(2, 2, ['b.spec.ts'], meta)])),
    ).toContain(message);
  });

  it('разное число шардов — отказ', () => {
    expect(
      refusal(() =>
        mergeShardReports([
          shard(1, 2, ['a.spec.ts']),
          shard(2, 3, ['b.spec.ts'], { shard: '2/3', partial: 'shard 2/3' }),
        ]),
      ),
    ).toContain('шардов 3 ≠ 2');
  });

  it('файл в двух шардах — отказ с файлом', () => {
    expect(
      refusal(() =>
        mergeShardReports([shard(1, 2, ['a.spec.ts', 'x.spec.ts']), shard(2, 2, ['b.spec.ts', 'x.spec.ts'])]),
      ),
    ).toContain('x.spec.ts (shard-1.json и shard-2.json)');
  });

  it('общая причина частичности, кроме шарда, остаётся в склеенном отчёте', () => {
    const merged = mergeShardReports([
      shard(1, 2, ['a.spec.ts'], { partial: 'changed-since main, shard 1/2' }),
      shard(2, 2, ['b.spec.ts'], { partial: 'changed-since main, shard 2/2' }),
    ]);
    expect(merged.jestGroups).toEqual({ tool: 'jest', groups: 2, shards: 2, partial: 'changed-since main' });
  });

  it('не отчёт шарда, отчёт без плана (старая версия) и пустой список — отказ', () => {
    const plain = {
      path: 'plain.json',
      report: { success: true, testResults: [], jestGroups: { tool: 'jest', groups: 1 } },
    };
    expect(refusal(() => mergeShardReports([plain as never]))).toContain('не отчёт шарда');
    const old = shard(1, 1, ['a.spec.ts']);
    const { plan: _plan, files: _files, ...rest } = old.report.jestGroups as ReportMeta;
    expect(
      refusal(() => mergeShardReports([{ ...old, report: { ...old.report, jestGroups: rest } }])),
    ).toContain('до 0.9.0');
    expect(refusal(() => mergeShardReports([]))).toContain('склеивать нечего');
  });
});
