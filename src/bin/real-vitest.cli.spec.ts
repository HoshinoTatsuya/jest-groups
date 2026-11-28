import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Собранный `vitest-groups` против НАСТОЯЩЕГО vitest каждой поддерживаемой
 * линии (devDependencies пакета: 4.1 и latest 5.x) во временном проекте.
 * Проверяется то, что у vitest устроено иначе, чем у jest: путь в команде —
 * фильтр-подстрока, воркеры проекта из конфига, форма выборки и отчёта.
 *
 * Бинарь — по пути пакета, а не `.bin/vitest`: оба пакета объявляют один
 * bin, и ссылка `.bin` достаётся одному из них по воле менеджера пакетов.
 * Линия 5 с её провайдером покрытия — отдельный пакет рабочего пространства
 * (`test-deps/vitest-5`): под псевдонимом в корне провайдер 5.x находил бы
 * свой peer `vitest` в корне, то есть vitest 4.
 */
const RUNNER = join(__dirname, '..', '..', 'dist', 'bin', 'vitest-groups.js');
const ASSERT = join(__dirname, '..', '..', 'dist', 'bin', 'jest-assert-no-skipped.js');
const MODULES = join(__dirname, '..', '..', 'node_modules');
const MODULES_5 = join(__dirname, '..', '..', 'test-deps', 'vitest-5', 'node_modules');
const VITESTS = [
  ['4', join(MODULES, 'vitest'), join(MODULES, '@vitest', 'coverage-v8')],
  ['5 (latest)', join(MODULES_5, 'vitest'), join(MODULES_5, '@vitest', 'coverage-v8')],
] as const;
if (!existsSync(RUNNER)) {
  throw new Error(`нет ${RUNNER}: сначала pnpm run build`);
}

it('фикстуры различны: линии vitest 4 и 5', () => {
  const major = (dir: string) =>
    (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version.split(
      '.',
    )[0];
  expect(VITESTS.map(([, dir]) => major(dir))).toEqual(['4', '5']);
  // Провайдер покрытия — той же линии, что vitest, и его peer `vitest` — именно этот vitest.
  expect(VITESTS.map(([, , coverage]) => major(coverage))).toEqual(['4', '5']);
  expect(
    VITESTS.map(
      ([, dir, coverage]) => realpathSync(join(coverage, '..', '..', 'vitest')) === realpathSync(dir),
    ),
  ).toEqual([true, true]);
});

describe.each(VITESTS)('vitest-groups на настоящем vitest %s', (_line, vitest, coverageProvider) => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'vitest-groups-real-')));
    mkdirSync(join(work, 'test'));
    writeFileSync(join(work, 'package.json'), '{"name":"probe","private":true,"type":"module"}\n');
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const write = (file: string, text: string): void => writeFileSync(join(work, file), text);
  const runner = (env: Record<string, string> = {}, flags: readonly string[] = []) =>
    spawnSync(
      process.execPath,
      [
        RUNNER,
        '--out',
        join(work, 'r.json'),
        ...flags,
        '--',
        process.execPath,
        join(vitest, 'vitest.mjs'),
        '--config',
        'vitest.config.mjs',
      ],
      {
        cwd: work,
        encoding: 'utf8',
        env: {
          ...process.env,
          JEST_GROUP_WORKERS: '2',
          JEST_GROUP_MIN_FREE_MB: '0',
          JEST_GROUPS_STRICT: '',
          CI: '1',
          ...env,
        },
      },
    );
  const report = () =>
    JSON.parse(readFileSync(join(work, 'r.json'), 'utf8')) as {
      numTotalTests: number;
      testResults: { name: string }[];
      jestGroups: unknown;
    };
  const groupLines = (stdout: string): string[] =>
    stdout.split('\n').filter((line) => line.startsWith('[группа '));

  it('файл, имя которого — подстрока пути другого, идёт с ним одной группой: ничего не выполнено дважды', () => {
    write(
      'vitest.config.mjs',
      "export default { test: { globals: true, include: ['test/**/*.test.js'] } };\n",
    );
    // vitest 4.1 сравнивает фильтр подстрокой: `test/a.test.js` захватывает `test/data.test.js`.
    write('test/a.test.js', "it('a', () => expect(1).toBe(1));\n");
    write('test/data.test.js', "it('data', () => expect(1).toBe(1));\n");
    write('test/b.test.js', "it('b', () => expect(1).toBe(1));\n");
    // Потолок 1 — чтобы разнести файлы; единица плана из двух файлов сама его
    // тяжелее (делить её нельзя). Проверяется «ничего дважды», превышение — строкой.
    const result = runner({ JEST_GROUP_MAX_TESTS: '1', JEST_GROUPS_STRICT: '0' });

    expect(result.stdout).toContain('потолок факта 1 превышен');
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: expect.not.stringContaining('ОТКАЗ'),
    });
    expect(groupLines(result.stdout)).toHaveLength(2);
    expect(
      report()
        .testResults.map((suite) => suite.name.slice(work.length + 1))
        .sort(),
    ).toEqual(['test/a.test.js', 'test/b.test.js', 'test/data.test.js']);
    expect(report().jestGroups).toEqual({ tool: 'vitest', groups: 2 });
  }, 120_000);

  /** Проект просит 8 воркеров; шесть файлов по 300 мс — поводов взять больше двух. */
  const writeWideProject = (): void => {
    write(
      'vitest.config.mjs',
      "export default { test: { projects: [{ test: { name: 'p', globals: true, maxWorkers: 8, include: ['test/**/*.test.js'] } }] } };\n",
    );
    for (let index = 0; index < 6; index++) {
      write(
        `test/w${index}.test.js`,
        `import { appendFileSync } from 'node:fs';\nit('w', async () => {\n  appendFileSync(${JSON.stringify(join(work, 'pool.log'))}, process.env.VITEST_POOL_ID + '\\n');\n  await new Promise((resolve) => setTimeout(resolve, 300));\n});\n`,
      );
    }
  };
  const pools = (): Set<string> =>
    new Set(readFileSync(join(work, 'pool.log'), 'utf8').split('\n').filter(Boolean));

  it('контроль фикстуры: без раннера тот же проект берёт больше двух воркеров', () => {
    writeWideProject();
    const direct = spawnSync(
      process.execPath,
      [join(vitest, 'vitest.mjs'), 'run', '--config', 'vitest.config.mjs'],
      {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', VITEST_MAX_WORKERS: '' },
      },
    );

    expect(direct.status).toBe(0);
    expect(pools().size).toBeGreaterThan(2);
  }, 120_000);

  it('maxWorkers проекта в конфиге не поднимает число воркеров выше двух', () => {
    writeWideProject();
    const result = runner();

    expect(result.status).toBe(0);
    expect(pools().size).toBeGreaterThanOrEqual(1);
    expect([...pools()].every((id) => Number(id) >= 1 && Number(id) <= 2)).toBe(true);
    expect(report().numTotalTests).toBe(6);
  }, 120_000);

  it('пропущенный тест vitest виден проверке пропусков по слитому отчёту', () => {
    write(
      'vitest.config.mjs',
      "export default { test: { globals: true, include: ['test/**/*.test.js'] } };\n",
    );
    write('test/s.test.js', "it('ok', () => {});\nit.skip('later', () => {});\n");
    expect(runner().status).toBe(0);
    const check = spawnSync(process.execPath, [ASSERT, join(work, 'r.json')], { encoding: 'utf8' });
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('пропущено тестов: 1');
  }, 120_000);

  describe('слияние покрытия самим vitest (--merge-coverage)', () => {
    const MERGED = 'coverage-final.json';
    /** Две спеки, каждая покрывает половину src/math.js; порог — в конфиге проекта. */
    const writeCoverageProject = (thresholds: string, extra = ''): void => {
      mkdirSync(join(work, 'src'));
      mkdirSync(join(work, 'node_modules', '@vitest'), { recursive: true });
      symlinkSync(coverageProvider, join(work, 'node_modules', '@vitest', 'coverage-v8'), 'dir');
      write(
        'src/math.js',
        `export function add(a, b) {\n  return a + b;\n}\nexport function mul(a, b) {\n  return a * b;\n}\n${extra}`,
      );
      write(
        'test/add.test.js',
        "import { add } from '../src/math.js';\nit('add', () => expect(add(1, 2)).toBe(3));\n",
      );
      write(
        'test/mul.test.js',
        "import { mul } from '../src/math.js';\nit('mul', () => expect(mul(2, 3)).toBe(6));\n",
      );
      write(
        'vitest.config.mjs',
        "export default { test: { globals: true, include: ['test/**/*.test.js'], " +
          `coverage: { provider: 'v8', include: ['src/**'], thresholds: ${thresholds} } } };\n`,
      );
    };
    const coverageOf = (): Record<string, { s: Record<string, number> }> =>
      JSON.parse(readFileSync(join(work, MERGED), 'utf8')) as Record<string, { s: Record<string, number> }>;
    const twoGroups = { JEST_GROUP_MAX_TESTS: '1' };

    it('контроль фикстуры: одна группа сама по себе ниже порога 90 % — vitest выходит с кодом 1', () => {
      writeCoverageProject('{ lines: 90, functions: 90 }');
      const alone = spawnSync(
        process.execPath,
        [
          join(vitest, 'vitest.mjs'),
          'run',
          '--config',
          'vitest.config.mjs',
          '--coverage.enabled=true',
          'test/add.test.js',
        ],
        { cwd: work, encoding: 'utf8', env: { ...process.env, CI: '1' } },
      );
      expect(alone.status).toBe(1);
      expect(`${alone.stdout}${alone.stderr}`).toContain('does not meet');
    }, 120_000);

    it('группы по 50 % не падают на пороге 90 %, слитое 100 % его проходит; покрытие слито по всем группам', () => {
      writeCoverageProject('{ lines: 90, functions: 90 }');
      const result = runner(twoGroups, ['--merge-coverage', join(work, MERGED)]);

      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 0,
        stderr: expect.not.stringContaining('ОТКАЗ'),
      });
      expect(groupLines(result.stdout)).toHaveLength(2);
      const math = Object.entries(coverageOf()).find(([file]) => file.endsWith(join('src', 'math.js')));
      expect(math).toBeDefined();
      // Каждый оператор файла выполнен хоть одной группой: слиты обе половины, а не последняя.
      expect(Object.values(math?.[1].s ?? {}).every((hits) => hits > 0)).toBe(true);
      expect(report().numTotalTests).toBe(2);
    }, 120_000);

    it('слитое ниже порога — код 1 и отказ по порогу, текст порога — от vitest', () => {
      writeCoverageProject(
        '{ lines: 100, functions: 100 }',
        'export function sub(a, b) {\n  return a - b;\n}\n',
      );
      const result = runner(twoGroups, ['--merge-coverage', join(work, MERGED)]);
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain('does not meet');
      expect(output).toContain('порог покрытия не выполнен по слитому покрытию всех групп');
      // Слитое покрытие записано и при отказе по порогу: по нему видно, чего не хватает.
      expect(existsSync(join(work, MERGED))).toBe(true);
    }, 120_000);

    it('шард — часть набора: порог не сверяется, и это названо', () => {
      writeCoverageProject('{ lines: 90, functions: 90 }');
      const result = runner(twoGroups, ['--merge-coverage', join(work, MERGED), '--shard', '1/2']);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('порог покрытия не сверяется: прогон покрыл не весь набор');
      expect(existsSync(join(work, MERGED))).toBe(true);
    }, 120_000);
  });
});
