import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProcessRunner } from '../types/process-runner.type';
import { runMergeCli } from './run-merge-cli';

/**
 * CLI склейки шардов: файлы, коды выхода и покрытие шардов jest с порогом по слитому. Команда
 * jest подменена портом процессов: порог берётся из её `--showConfig`.
 */
describe('runMergeCli', () => {
  let work = '';
  let lines: string[] = [];
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-merge-')));
    lines = [];
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const at = (file: string): string => join(work, file);
  const writeShard = (index: number, count: number, files: string[], tool = 'jest'): string => {
    const path = at(`shard-${index}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        success: true,
        numTotalTests: files.length,
        testResults: files.map((file) => ({
          name: at(file),
          assertionResults: [{ status: 'passed', fullName: file }],
        })),
        jestGroups: {
          tool,
          groups: 1,
          partial: `shard ${index}/${count}`,
          shard: `${index}/${count}`,
          plan: 'p',
          files,
        },
      }),
    );
    return path;
  };
  /** Покрытие шарда: файл из двух операторов, шард выполнил отмеченные. */
  const writeCoverage = (name: string, hits: [number, number]): string => {
    const file = at('src/a.ts');
    const span = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
    writeFileSync(
      at(name),
      JSON.stringify({
        [file]: {
          path: file,
          statementMap: { 0: span(1), 1: span(2) },
          s: { 0: hits[0], 1: hits[1] },
          fnMap: {},
          f: {},
          branchMap: {},
          b: {},
        },
      }),
    );
    return at(name);
  };
  const showConfig =
    (threshold: unknown): ProcessRunner =>
    async () => ({
      status: 0,
      stdout: JSON.stringify({
        configs: [{}],
        globalConfig: { coverageThreshold: threshold },
        version: '30.5.2',
      }),
    });
  const merge = (argv: string[], run: ProcessRunner = showConfig(undefined)) =>
    runMergeCli(argv, run, (line) => lines.push(line));

  it('два шарда — склеенный отчёт всего набора, код 0', async () => {
    const code = await merge([
      '--out',
      at('merged.json'),
      writeShard(1, 2, ['a.spec.ts']),
      writeShard(2, 2, ['b.spec.ts']),
    ]);
    expect(code).toBe(0);
    const merged = JSON.parse(readFileSync(at('merged.json'), 'utf8')) as {
      numTotalTests: number;
      jestGroups: unknown;
    };
    expect(merged).toMatchObject({ numTotalTests: 2, jestGroups: { tool: 'jest', groups: 2, shards: 2 } });
    expect(lines).toEqual(['[склейка шардов] шардов 2, групп 2, тестов 2']);
  });

  it('отказ склейки — код 2, и прежний зелёный отчёт удалён: его не прочтут как свежий', async () => {
    writeFileSync(at('merged.json'), '{"success":true}');
    expect(await merge(['--out', at('merged.json'), writeShard(1, 2, ['a.spec.ts'])])).toBe(2);
    expect(existsSync(at('merged.json'))).toBe(false);
  });

  it('покрытие шардов сливается, порог проекта сверяется по слитому: 50 % + 50 % = 100 % проходит 90 %', async () => {
    const shards = [writeShard(1, 2, ['a.spec.ts']), writeShard(2, 2, ['b.spec.ts'])];
    const argv = [
      '--out',
      at('merged.json'),
      '--merge-coverage',
      at('coverage.json'),
      '--coverage',
      writeCoverage('c1.json', [1, 0]),
      '--coverage',
      writeCoverage('c2.json', [0, 1]),
      ...shards,
      '--',
      'jest',
    ];
    expect(await merge(argv, showConfig({ global: { lines: 90 } }))).toBe(0);
    const coverage = JSON.parse(readFileSync(at('coverage.json'), 'utf8')) as Record<
      string,
      { s: Record<string, number> }
    >;
    expect(coverage[at('src/a.ts')]?.s).toEqual({ 0: 1, 1: 1 });
  });

  it('слитое ниже порога — код 1, текст как у jest', async () => {
    const argv = [
      '--out',
      at('merged.json'),
      '--merge-coverage',
      at('coverage.json'),
      '--coverage',
      writeCoverage('c1.json', [1, 0]),
      '--coverage',
      writeCoverage('c2.json', [1, 0]),
      writeShard(1, 2, ['a.spec.ts']),
      writeShard(2, 2, ['b.spec.ts']),
      '--',
      'jest',
    ];
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await merge(argv, showConfig({ global: { lines: 90 } }))).toBe(1);
      expect(errors.mock.calls.flat().join('\n')).toContain('(50%)');
    } finally {
      errors.mockRestore();
    }
  });

  it.each([
    ['покрытий меньше, чем шардов', ['--coverage', 'ONE'], 'покрытий шардов 1, отчётов 2', 'jest'],
    ['без команды jest', ['--coverage', 'ONE', '--coverage', 'TWO'], 'нужна команда jest после «--»', null],
    [
      'одно покрытие дважды',
      ['--coverage', 'ONE', '--coverage', 'ONE'],
      'покрытие шарда задано дважды',
      'jest',
    ],
    ['шарды vitest', ['--coverage', 'ONE', '--coverage', 'TWO'], 'только jest', 'jest'],
  ])('покрытие: %s — отказ (код 2)', async (name, coverageArgs, message, command) => {
    const tool = name === 'шарды vitest' ? 'vitest' : 'jest';
    const args = coverageArgs.map((arg) =>
      arg === 'ONE'
        ? writeCoverage('c1.json', [1, 0])
        : arg === 'TWO'
          ? writeCoverage('c2.json', [0, 1])
          : arg,
    );
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const code = await merge([
        '--out',
        at('merged.json'),
        '--merge-coverage',
        at('coverage.json'),
        ...args,
        writeShard(1, 2, ['a.spec.ts'], tool),
        writeShard(2, 2, ['b.spec.ts'], tool),
        ...(command === null ? [] : ['--', command]),
      ]);
      expect(code).toBe(2);
      expect(errors.mock.calls.flat().join('\n')).toContain(message);
    } finally {
      errors.mockRestore();
    }
  });
});
