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
 * Собранный раннер против НАСТОЯЩЕГО jest (тот, что стоит у пакета) в
 * маленьком временном проекте: то, что поддельный jest доказать не может, —
 * как jest 30 сам ведёт себя с флагами, которые ему передаёт раннер.
 * Группы — по одному файлу (`JEST_GROUP_MAX_TESTS=1`), воркер один (спека сама идёт в
 * группе внешнего раннера), файлы
 * крошечные: весь блок — секунды. `JEST_GROUPS_RUNNER` — путь к другой сборке
 * раннера (проверить, что спека краснеет на прежней версии).
 */
const RUNNER = process.env.JEST_GROUPS_RUNNER ?? join(__dirname, '..', '..', 'dist', 'bin', 'jest-groups.js');
const JEST = join(__dirname, '..', '..', 'node_modules', '.bin', 'jest');
if (!existsSync(RUNNER)) {
  throw new Error(`нет ${RUNNER}: сначала pnpm run build`);
}

describe('раннер на настоящем jest', () => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-real-')));
    mkdirSync(join(work, 'src'));
    mkdirSync(join(work, 'test'));
    writeFileSync(join(work, 'package.json'), '{"name":"probe","private":true}\n');
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const write = (file: string, text: string): void => writeFileSync(join(work, file), text);
  const config = (extra: Record<string, unknown>): void =>
    write(
      'jest.config.js',
      // Корень haste — весь проект: иначе jest не видит непокрытых исходников
      // (collectCoverageFrom вне roots), и группа считала бы покрытым всё, что загрузила.
      `module.exports = ${JSON.stringify({ testEnvironment: 'node', transform: {}, testMatch: ['<rootDir>/test/**/*.spec.js'], ...extra })};\n`,
    );
  const runner = (flags: string[], jestArgs: string[] = [], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [RUNNER, '--out', join(work, 'r.json'), ...flags, '--', JEST, ...jestArgs], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        JEST_GROUP_MAX_TESTS: '1',
        JEST_GROUP_WORKERS: '1',
        JEST_GROUP_MIN_FREE_MB: '0',
        JEST_GROUPS_STRICT: '',
        ...env,
      },
    });
  const executed = (): string[] =>
    (
      JSON.parse(readFileSync(join(work, 'r.json'), 'utf8')) as { testResults: { name: string }[] }
    ).testResults
      .map((suite) => suite.name.slice(work.length + 1))
      .sort();
  const groupLines = (stdout: string): string[] =>
    stdout.split('\n').filter((line) => line.startsWith('[группа '));

  /** Два исходника, по спеке на каждый: каждая группа покрывает половину кода. */
  const halves = (bUncovered: boolean): void => {
    write('src/a.js', 'module.exports = (x) => x + 1;\n');
    write(
      'src/b.js',
      bUncovered
        ? 'module.exports = (x) => {\n  if (x > 100) {\n    return 0;\n  }\n  return x * 2;\n};\n'
        : 'module.exports = (x) => x * 2;\n',
    );
    write('test/a.spec.js', "const a = require('../src/a');\nit('a', () => expect(a(1)).toBe(2));\n");
    write('test/b.spec.js', "const b = require('../src/b');\nit('b', () => expect(b(1)).toBe(2));\n");
  };

  describe('порог покрытия проекта и --merge-coverage (Н4)', () => {
    it('каждая группа покрывает половину, набор — всё: порог 90 % выполнен, обе группы прошли', () => {
      halves(false);
      config({
        coverageProvider: 'v8',
        collectCoverageFrom: ['src/**/*.js'],
        coverageThreshold: { global: { lines: 90 } },
      });
      const result = runner(['--merge-coverage', join(work, 'cov', 'coverage-final.json')]);

      // Прежде группа 1 падала «threshold for lines (90%) not met», остальные не запускались.
      expect({ status: result.status, stderr: result.stderr.includes('not met') }).toEqual({
        status: 0,
        stderr: false,
      });
      expect(groupLines(result.stdout)).toHaveLength(2);
      const merged = JSON.parse(readFileSync(join(work, 'cov', 'coverage-final.json'), 'utf8')) as object;
      expect(
        Object.keys(merged)
          .map((file) => file.slice(work.length + 1))
          .sort(),
      ).toEqual(['src/a.js', 'src/b.js']);
    }, 60_000);

    it('порог не выполнен на слитом покрытии — отказ тем же текстом, что у полного прогона jest', () => {
      halves(true);
      config({
        coverageProvider: 'v8',
        collectCoverageFrom: ['src/**/*.js'],
        coverageThreshold: { global: { lines: 100, functions: 100 } },
      });
      const plain = spawnSync(JEST, ['--ci', '--coverage', '--coverageReporters=json', '--maxWorkers=1'], {
        cwd: work,
        encoding: 'utf8',
      });
      const expected = `${plain.stdout}\n${plain.stderr}`
        .split('\n')
        .filter((line) => line.startsWith('Jest: '))
        .map((line) => line.trim());
      expect(expected.length).toBeGreaterThan(0);

      const result = runner(['--merge-coverage', join(work, 'cov', 'coverage-final.json')]);

      expect(result.status).toBe(1);
      expect(groupLines(result.stdout)).toHaveLength(2);
      expect(
        result.stderr
          .replace(/^ОТКАЗ раннера групп jest: /m, '')
          .split('\n')
          .filter((line) => line.startsWith('Jest: ')),
      ).toEqual(expected);
    }, 60_000);
  });

  describe('«только изменённое»: гипотеза «каждая группа гонит всё» опровергнута — закреплено', () => {
    const git = (...args: string[]): void => {
      const done = spawnSync(
        'git',
        ['-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', ...args],
        {
          cwd: work,
          encoding: 'utf8',
        },
      );
      if (done.status !== 0) {
        throw new Error(`git ${args.join(' ')}: ${done.stderr}`);
      }
    };
    beforeEach(() => {
      config({});
      for (const name of ['a', 'b', 'c', 'd']) {
        write(`test/${name}.spec.js`, `it('${name}', () => expect(1).toBe(1));\n`);
      }
      git('init', '-q');
      git('add', '-A');
      git('commit', '-q', '-m', 'probe');
      write('test/a.spec.js', "it('a', () => expect(2).toBe(2));\n");
      write('test/c.spec.js', "it('c', () => expect(3).toBe(3));\n");
    });

    it('-o в команде: выборка — только изменённые, каждая группа — только свои пути', () => {
      const result = runner([], ['-o']);
      expect(result.status).toBe(0);
      expect(executed()).toEqual(['test/a.spec.js', 'test/c.spec.js']);
      // Две группы, в каждой — один файл и один тест (формат строки журнала не важен).
      expect(groupLines(result.stdout).map((line) => / файлов 1, тестов 1 /.test(line))).toEqual([
        true,
        true,
      ]);
    }, 60_000);

    it('--changed-since HEAD: то же, а отчёт помечен частичным', () => {
      const result = runner(['--changed-since', 'HEAD']);
      expect(result.status).toBe(0);
      expect(executed()).toEqual(['test/a.spec.js', 'test/c.spec.js']);
      expect(groupLines(result.stdout)).toHaveLength(2);
      expect(
        (JSON.parse(readFileSync(join(work, 'r.json'), 'utf8')) as { jestGroups: unknown }).jestGroups,
      ).toEqual({
        tool: 'jest',
        groups: 2,
        partial: 'changed-since HEAD',
      });
    }, 60_000);
  });

  it('файл в двух проектах: jest гонит его дважды в своей группе — не «выполнен дважды», факт — сумма', () => {
    write('test/a.spec.js', "it('a1', () => {});\nit('a2', () => {});\n");
    write('test/b.spec.js', "it('b1', () => {});\nit('b2', () => {});\n");
    write(
      'jest.config.js',
      `module.exports = { projects: [
        { displayName: 'one', testEnvironment: 'node', transform: {}, testMatch: ['<rootDir>/test/*.spec.js'] },
        { displayName: 'two', testEnvironment: 'node', transform: {}, testMatch: ['<rootDir>/test/a.spec.js'] },
      ] };\n`,
    );
    // Потолок 1 здесь — чтобы разнести файлы по группам; a.spec.js в двух
    // проектах сам тяжелее его. Проверяется сверка копий, превышение — строкой.
    const result = runner([], [], { JEST_GROUPS_STRICT: '0' });

    expect(result.stderr).not.toContain('выполнены дважды');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('потолок факта 1 превышен');
    expect(
      (JSON.parse(readFileSync(join(work, 'r.json'), 'utf8')) as { numTotalTests: number }).numTotalTests,
    ).toBe(6);
  }, 60_000);

  describe('--collect-tests: файлы без доказанного числа считает сам jest', () => {
    /** Тесты строит функция из другого модуля: по тексту число не доказать. Тела пишут в ran.log. */
    const generated = (file: string, count: number): void => {
      write(
        `test/${file}.cases.js`,
        `module.exports = () => Array.from({ length: ${count} }, (_, i) => i);\n`,
      );
      write(
        `test/${file}.spec.js`,
        `const cases = require('./${file}.cases');\nfor (const n of cases()) it('case ' + n, () => require('fs').appendFileSync(${JSON.stringify(join(work, 'ran.log'))}, 'x'));\n`,
      );
    };
    const ran = (): number =>
      existsSync(join(work, 'ran.log')) ? readFileSync(join(work, 'ran.log'), 'utf8').length : 0;
    const roomy = { JEST_GROUP_MAX_TESTS: '300' };

    it('контроль: без флага каждый такой файл идёт полной группой — по группе на файл', () => {
      config({});
      generated('a', 7);
      generated('b', 5);
      const result = runner([], [], roomy);

      expect(result.status).toBe(0);
      expect(groupLines(result.stdout)).toHaveLength(2);
    }, 60_000);

    it('с флагом — точные числа до прогона: одна группа, тела тестов выполнены ровно по разу', () => {
      config({});
      generated('a', 7);
      generated('b', 5);
      const result = runner(['--collect-tests'], [], roomy);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('без выполнения сосчитаны тесты файлов: 2 из 2');
      expect(groupLines(result.stdout)).toHaveLength(1);
      expect(result.stdout).toContain('тестов 12 (план 12)');
      // Подсчёт не выполняет тела: каждое — один раз, в своей группе.
      expect(ran()).toBe(12);
    }, 60_000);

    it('файл, который не загрузился при подсчёте, планируется прежним способом, и это названо', () => {
      config({});
      generated('a', 7);
      write('test/broken.cases.js', "throw new Error('сломан');\n");
      write(
        'test/broken.spec.js',
        "const cases = require('./broken.cases');\nfor (const n of cases()) it(String(n), () => {});\n",
      );
      const result = runner(['--collect-tests'], [], roomy);

      expect(result.stdout).toContain('без выполнения сосчитаны тесты файлов: 1 из 2');
      // Сломанный файл падает уже в своей группе — как без подсчёта.
      expect(result.status).toBe(1);
    }, 60_000);
  });
});
