import { createRequire } from 'node:module';

import type { FileCoverage } from '../types/file-coverage.type';
import { checkCoverageThreshold } from './check-coverage-threshold';
import { coveragePercent } from './coverage-percent';
import { summarizeCoverage } from './summarize-coverage';

/** istanbul той версии, что считает покрытие jest: эталон, с которым сверяется своя сводка. */
const istanbul = createRequire(require.resolve('jest'))('istanbul-lib-coverage') as {
  createFileCoverage: (data: unknown) => {
    toSummary: () => { data: Record<string, { total: number; covered: number; pct: number }> };
  };
};

/** Покрытие файла: операторы на строках `lines` со счётчиками `hits`, функции и ветви. */
const file = (
  path: string,
  lines: number[],
  hits: number[],
  functions: number[] = [],
  branches: number[][] = [],
): FileCoverage => ({
  path,
  statementMap: Object.fromEntries(
    lines.map((line, id) => [String(id), { start: { line, column: 0 }, end: { line, column: 1 } }]),
  ),
  fnMap: Object.fromEntries(
    functions.map((_, id) => [
      String(id),
      {
        name: `f${id}`,
        decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        line: 1,
      },
    ]),
  ),
  branchMap: Object.fromEntries(
    branches.map((arms, id) => [
      String(id),
      {
        type: 'if',
        line: 1,
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        locations: arms.map(() => ({ start: { line: 1, column: 0 }, end: { line: 1, column: 1 } })),
      },
    ]),
  ),
  s: Object.fromEntries(hits.map((count, id) => [String(id), count])),
  f: Object.fromEntries(functions.map((count, id) => [String(id), count])),
  b: Object.fromEntries(branches.map((arms, id) => [String(id), arms])),
});

describe('summarizeCoverage — то же, что istanbul', () => {
  it('строка покрыта, если покрыт хоть один её оператор; ветви — по исходам', () => {
    const coverage = file('/p/a.ts', [1, 1, 2, 3], [1, 0, 0, 1], [1, 0], [[1, 0], [0]]);
    expect(summarizeCoverage(coverage)).toEqual({
      lines: { total: 3, covered: 2, pct: 66.66 },
      statements: { total: 4, covered: 2, pct: 50 },
      functions: { total: 2, covered: 1, pct: 50 },
      branches: { total: 3, covered: 1, pct: 33.33 },
    });
  });

  it('совпадает с istanbul на наборе случайных покрытий (детерминированный генератор)', () => {
    let seed = 7;
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % limit;
    };
    for (let round = 0; round < 50; round++) {
      const count = 1 + next(30);
      const lines = Array.from({ length: count }, () => 1 + next(10));
      const hits = Array.from({ length: count }, () => (next(3) === 0 ? 0 : next(5)));
      const functions = Array.from({ length: next(6) }, () => next(2));
      const branches = Array.from({ length: next(5) }, () =>
        Array.from({ length: 1 + next(3) }, () => next(2)),
      );
      const coverage = file(`/p/r${round}.ts`, lines, hits, functions, branches);
      const reference = istanbul.createFileCoverage(coverage).toSummary().data;
      const own = summarizeCoverage(coverage);
      for (const key of ['lines', 'statements', 'functions', 'branches'] as const) {
        expect({ round, key, ...own[key] }).toEqual({
          round,
          key,
          total: reference[key]?.total,
          covered: reference[key]?.covered,
          pct: reference[key]?.pct,
        });
      }
    }
  });

  it('процент — отсечение до сотых, пустая метрика — 100', () => {
    expect([
      coveragePercent(2, 3),
      coveragePercent(1, 3),
      coveragePercent(0, 0),
      coveragePercent(8999, 10000),
    ]).toEqual([66.66, 33.33, 100, 89.99]);
  });
});

describe('checkCoverageThreshold — семантика и текст jest 30 (до 30.4)', () => {
  const JEST_30_2 = '30.2.0';
  const coverage = {
    '/p/src/a.ts': file('/p/src/a.ts', [1, 2], [1, 1]),
    '/p/src/b.ts': file('/p/src/b.ts', [1, 2], [1, 0]),
    '/p/lib/c.ts': file('/p/lib/c.ts', [1, 2, 3, 4], [0, 0, 0, 1]),
  };

  it('global по сумме файлов: 4 из 8 строк — 50 %', () => {
    expect(
      checkCoverageThreshold(coverage, { global: { lines: 60, statements: 50 } }, '/p', JEST_30_2),
    ).toEqual(['Jest: "global" coverage threshold for lines (60%) not met: 50%']);
  });

  it('порог выполнен — пусто', () => {
    expect(checkCoverageThreshold(coverage, { global: { lines: 50 } }, '/p', JEST_30_2)).toEqual([]);
  });

  it('отрицательный порог — потолок непокрытых', () => {
    expect(checkCoverageThreshold(coverage, { global: { statements: -3 } }, '/p', JEST_30_2)).toEqual([
      'Jest: Uncovered count for statements (4) exceeds global threshold (3)',
    ]);
    expect(checkCoverageThreshold(coverage, { global: { statements: -4 } }, '/p', JEST_30_2)).toEqual([]);
  });

  it('путь каталога — сумма его файлов; попавшие в путь в global не считаются', () => {
    expect(
      checkCoverageThreshold(coverage, { global: { lines: 75 }, './src/': { lines: 80 } }, '/p', JEST_30_2),
    ).toEqual([
      'Jest: "global" coverage threshold for lines (75%) not met: 25%',
      'Jest: "./src/" coverage threshold for lines (80%) not met: 75%',
    ]);
  });

  it('glob — порог КАЖДОМУ файлу, имя в тексте — путь файла', () => {
    expect(checkCoverageThreshold(coverage, { './src/*.ts': { lines: 100 } }, '/p', JEST_30_2)).toEqual([
      'Jest: "/p/src/b.ts" coverage threshold for lines (100%) not met: 50%',
    ]);
  });

  it('путь без данных — «not found»; порядок метрик как у jest', () => {
    expect(
      checkCoverageThreshold(
        coverage,
        {
          './missing.ts': { lines: 1 },
          global: { functions: 100, lines: 100, branches: 100, statements: 100 },
        },
        '/p',
        JEST_30_2,
      ),
    ).toEqual([
      'Jest: Coverage data for ./missing.ts was not found.',
      'Jest: "global" coverage threshold for statements (100%) not met: 50%',
      'Jest: "global" coverage threshold for lines (100%) not met: 50%',
    ]);
  });
});

describe('текст процентного порога — по версии jest проекта', () => {
  const coverage = { '/p/src/b.ts': file('/p/src/b.ts', [1, 2], [1, 0]) };
  const OLD = 'Jest: "global" coverage threshold for lines (60%) not met: 50%';
  const NEW = 'Jest: Coverage for lines (50%) does not meet "global" threshold (60%)';

  it.each([
    ['29.7.0', OLD],
    ['30.2.0', OLD],
    ['30.3.0', OLD],
    // jest 30.4.0 сменил текст (@jest/reporters 30.3.0 → 30.4.0, CoverageReporter._checkThreshold).
    ['30.4.0', NEW],
    ['30.5.2', NEW],
    ['31.0.0-alpha.1', NEW],
    // Версии нет или она не разобрана — текст новейшего jest.
    [null, NEW],
    ['x.y', NEW],
  ])('%s → %s', (version, text) => {
    expect(checkCoverageThreshold(coverage, { global: { lines: 60 } }, '/p', version)).toEqual([text]);
  });

  it('потолок непокрытых и «не найдено» — один текст во всех версиях', () => {
    const wide = { ...coverage, '/p/lib/c.ts': file('/p/lib/c.ts', [1, 2, 3, 4], [0, 0, 0, 1]) };
    for (const version of ['30.2.0', '30.5.2', null]) {
      expect(
        checkCoverageThreshold(wide, { global: { lines: -2 }, './gone/': { lines: 1 } }, '/p', version),
      ).toEqual([
        'Jest: Uncovered count for lines (4) exceeds global threshold (2)',
        'Jest: Coverage data for ./gone/ was not found.',
      ]);
    }
  });
});
