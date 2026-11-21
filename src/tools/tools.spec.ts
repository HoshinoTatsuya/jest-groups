import { findOwnedFlags } from './find-owned-flags';
import { JEST_TOOL } from './jest.tool';
import { parseShowConfigOutput } from './parse-show-config-output';
import { parseVitestListOutput } from './parse-vitest-list-output';
import { VITEST_TOOL } from './vitest.tool';
import { vitestFilterUnits } from './vitest-filter-units';
import { withoutFlag } from './without-flag';

describe('findOwnedFlags (jest)', () => {
  const owned = (args: string[]) => findOwnedFlags(args, JEST_TOOL.owned);

  it.each([
    ['--maxWorkers=4'],
    ['--max-workers=4'],
    ['--max-workers'],
    ['--runInBand'],
    ['--run-in-band'],
    ['--watch'],
    ['--watchAll'],
    ['--watch-all'],
    ['--shard=1/2'],
    ['--json'],
    ['--outputFile=x'],
    ['--output-file=x'],
    ['-w'],
    ['-w4'],
    ['-w=4'],
    ['-i'],
    ['-bi'],
    ['-ib'],
  ])('%s — флаг раннера', (flag) => {
    expect(owned([flag])).toEqual([flag]);
  });

  it.each([
    ['--config=jest.db.js'],
    ['--testPathPatterns'],
    ['--watchman=false'],
    ['--no-watch'],
    ['--no-watchman'],
    ['-b'],
    ['-c'],
    ['-o'],
    ['--onlyChanged'],
    ['--changedSince=main'],
    ['a.spec.ts'],
    ['watch'],
  ])('%s — не флаг раннера (контроль)', (flag) => {
    expect(owned([flag])).toEqual([]);
  });

  it('из смеси возвращает только флаги раннера, в порядке команды', () => {
    expect(owned(['--config', 'x.js', '--max-workers=3', '-b', '--watch-all'])).toEqual([
      '--max-workers=3',
      '--watch-all',
    ]);
  });
});

describe('findOwnedFlags (vitest)', () => {
  const owned = (args: string[]) => findOwnedFlags(args, VITEST_TOOL.owned);

  it.each([
    ['run'],
    ['watch'],
    ['list'],
    ['-w'],
    ['--maxWorkers=8'],
    ['--max-workers=8'],
    ['--poolOptions.forks.maxForks=16'],
    ['--reporter=dot'],
    ['--outputFile.json=x'],
    ['--ui'],
  ])('%s — флаг или подкоманда раннера', (flag) => {
    expect(owned([flag])).toEqual([flag]);
  });

  it.each([['--config=vitest.config.ts'], ['--project=unit'], ['--no-watch'], ['--silent'], ['src']])(
    '%s — не флаг раннера (контроль)',
    (flag) => {
      expect(owned([flag])).toEqual([]);
    },
  );
});

describe('withoutFlag', () => {
  it('снимает флаг во всех написаниях, со значением отдельным аргументом и через =', () => {
    expect(
      withoutFlag(
        [
          '--config',
          'c.js',
          '--coverageThreshold',
          '{"global":{}}',
          '--coverage-threshold={}',
          '--coverageThreshold={"a":1}',
          '--coverage-threshold',
          '{}',
          '-b',
        ],
        'coverageThreshold',
      ),
    ).toEqual(['--config', 'c.js', '-b']);
  });
});

describe('группа jest', () => {
  it('порог покрытия снят только при слиянии покрытия, флаг из команды убран', () => {
    const args = (coverageDir?: string) =>
      JEST_TOOL.groupArgs({
        baseArgs: ['--config', 'c.js', '--coverageThreshold={"global":{"lines":90}}'],
        reportPath: '/w/r.json',
        workers: 2,
        files: ['/p/a.spec.ts'],
        ...(coverageDir === undefined ? {} : { coverageDir }),
      });
    expect(args('/w/cov')).toEqual([
      '--config',
      'c.js',
      '--ci',
      '--silent',
      '--json',
      '--outputFile=/w/r.json',
      '--maxWorkers=2',
      '--coverage',
      '--coverageReporters=json',
      '--coverageDirectory=/w/cov',
      '--coverageThreshold={}',
      '--runTestsByPath',
      '/p/a.spec.ts',
    ]);
    // Без слияния порог не трогается: покрытие не собирается, порог не действует.
    expect(args()).toContain('--coverageThreshold={"global":{"lines":90}}');
  });

  it('«только изменённое» уходит в выборку, но не в группу', () => {
    expect(JEST_TOOL.listArgs(['--config', 'c.js'], 2, 'main')).toEqual([
      '--config',
      'c.js',
      '--listTests',
      '--json',
      '--changedSince=main',
    ]);
    expect(
      JEST_TOOL.groupArgs({ baseArgs: [], reportPath: 'r', workers: 2, files: ['/a'] }).join(' '),
    ).not.toContain('changed');
  });
});

describe('группа vitest', () => {
  it('воркеры — флагом и переменной (переменная действует и на проекты с maxWorkers в конфиге)', () => {
    expect(VITEST_TOOL.groupEnv(2)).toEqual({ VITEST_MAX_WORKERS: '2' });
    expect(
      VITEST_TOOL.groupArgs({ baseArgs: ['--config', 'v.ts'], reportPath: 'r', workers: 2, files: ['/a'] }),
    ).toEqual([
      '--config',
      'v.ts',
      'run',
      '--reporter=default',
      '--reporter=json',
      '--outputFile.json=r',
      '--maxWorkers=2',
      // Значение явно: у vitest 4 `--silent` берёт значение, и голый флаг съедал первый путь группы.
      '--silent=true',
      '/a',
    ]);
    expect(VITEST_TOOL.listArgs([], 2, 'HEAD')).toEqual([
      'list',
      '--filesOnly',
      '--json',
      '--maxWorkers=2',
      '--changed=HEAD',
    ]);
  });
});

describe('parseVitestListOutput', () => {
  it('файлы из массива объектов; файл в двух проектах — две записи', () => {
    const stdout = `шум\n${JSON.stringify(
      [
        { file: '/p/a.test.ts', projectName: 'unit' },
        { file: '/p/a.test.ts', projectName: 'int' },
        { file: '/p/b.test.ts' },
      ],
      null,
      2,
    )}\n`;
    expect(parseVitestListOutput(stdout)).toEqual(['/p/a.test.ts', '/p/a.test.ts', '/p/b.test.ts']);
  });

  it('вложенные скобки внутри объектов не обрывают массив', () => {
    expect(parseVitestListOutput('[{"file":"/a","tags":["x"]},{"file":"/b"}]\n')).toEqual(['/a', '/b']);
  });

  it('массив строк — не выборка vitest; нет массива — null', () => {
    expect(parseVitestListOutput('["/a"]\n')).toBeNull();
    expect(parseVitestListOutput('ничего\n')).toBeNull();
  });
});

describe('vitestFilterUnits', () => {
  it('файл, чьё имя — подстрока пути другого, идёт с ним одной единицей; остальные отдельно', () => {
    // vitest 4.1 сравнивает фильтр подстрокой: `a.spec.ts` захватывает `data.spec.ts`.
    expect(
      vitestFilterUnits(['a.spec.ts', 'data.spec.ts', 'b.spec.ts', 'x/c.spec.ts', 'y/x/c.spec.ts']),
    ).toEqual([['a.spec.ts', 'data.spec.ts'], ['b.spec.ts'], ['x/c.spec.ts', 'y/x/c.spec.ts']]);
  });

  it('связь транзитивна: цепочка захватов — одна единица', () => {
    expect(vitestFilterUnits(['b.ts', 'ab.ts', 'cab.ts', 'z.ts'])).toEqual([
      ['ab.ts', 'b.ts', 'cab.ts'],
      ['z.ts'],
    ]);
  });

  it('регистр не важен (vitest сравнивает в нижнем регистре)', () => {
    expect(vitestFilterUnits(['A.spec.ts', 'da.spec.ts'])).toEqual([['A.spec.ts', 'da.spec.ts']]);
  });
});

describe('parseShowConfigOutput', () => {
  it('число проектов и порог покрытия из глобального конфига, шум обёртки вокруг', () => {
    const shown = JSON.stringify(
      {
        configs: [{ rootDir: '/p' }, { rootDir: '/p' }],
        globalConfig: { coverageThreshold: { global: { lines: 90 } } },
        version: '30.5.2',
      },
      null,
      '  ',
    );
    expect(parseShowConfigOutput(`> pnpm\n${shown}\nготово\n`)).toEqual({
      projects: 2,
      coverageThreshold: { global: { lines: 90 } },
      version: '30.5.2',
    });
  });

  it('порога нет — null; вывода той формы нет — null', () => {
    expect(parseShowConfigOutput(JSON.stringify({ configs: [{}], globalConfig: {}, version: 30 }))).toEqual({
      projects: 1,
      coverageThreshold: null,
      version: null,
    });
    expect(parseShowConfigOutput('{"a": 1}\n')).toBeNull();
  });
});
