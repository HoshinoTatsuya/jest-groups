import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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
 */
const RUNNER = join(__dirname, '..', '..', 'dist', 'bin', 'vitest-groups.js');
const ASSERT = join(__dirname, '..', '..', 'dist', 'bin', 'jest-assert-no-skipped.js');
const MODULES = join(__dirname, '..', '..', 'node_modules');
const VITESTS = [
  ['4', join(MODULES, 'vitest')],
  ['5 (latest)', join(MODULES, 'vitest-5')],
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
});

describe.each(VITESTS)('vitest-groups на настоящем vitest %s', (_line, vitest) => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'vitest-groups-real-')));
    mkdirSync(join(work, 'test'));
    writeFileSync(join(work, 'package.json'), '{"name":"probe","private":true,"type":"module"}\n');
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const write = (file: string, text: string): void => writeFileSync(join(work, file), text);
  const runner = (env: Record<string, string> = {}) =>
    spawnSync(
      process.execPath,
      [
        RUNNER,
        '--out',
        join(work, 'r.json'),
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
});
