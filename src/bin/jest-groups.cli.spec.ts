import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { FAKE_JEST } from '../testing/fake-jest.source';
import { readCacheTests } from '../testing/read-cache-tests';
import { RunnerSandbox } from '../testing/runner-sandbox';

/**
 * Раннер групп jest (bin jest-groups) — то, на чём держится
 * обещание хука «не больше 300 тестов за раз, группы по очереди»: один jest на
 * весь набор клал ноутбук разработчика (09.11.2026). Что хук зовёт раннер,
 * держит гейт проекта; здесь — что раннер делает обещанное.
 *
 * Раннер гоняется по-настоящему, но вместо jest — поддельная команда: она
 * отдаёт выборку на `--listTests`, пишет журнал вызовов и отчёт в форме
 * `jest --json` с заданным числом тестов на файл. Так проверяются группы,
 * порядок, воркеры, слияние отчётов и отказы без запуска набора.
 */

/**
 * Проверяется СОБРАННЫЙ CLI — тот файл, который уезжает в пакет. `pnpm test`
 * собирает пакет перед прогоном; без сборки спека падает с объяснением, а не
 * проверяет устаревший dist.
 */
const RUNNER = join(__dirname, '..', '..', 'dist', 'bin', 'jest-groups.js');
if (!existsSync(RUNNER)) {
  throw new Error(`нет ${RUNNER}: сначала pnpm run build`);
}

type Run = {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: { event: string; files?: string[]; workers?: string; argv?: number }[];
  report: { numTotalTests: number; success: boolean; testResults: unknown[] } | null;
  cache: Record<string, number>;
};

describe('jest-groups CLI: потолок групп и очерёдность', () => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-spec-')));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  /** Запуск раннера в каталоге work; числа тестов известны раннеру из кэша. */
  const run = (
    counts: Record<string, number>,
    env: Record<string, string> = {},
    cached = true,
    flags: string[] = [],
    jestArgs: string[] = [],
    afterCache: () => void = () => undefined,
  ): Run => {
    const absolute = Object.fromEntries(Object.entries(counts).map(([file, n]) => [join(work, file), n]));
    // Файлы создаются, но не переписываются: отпечаток (mtime, размер) — то,
    // по чему раннер решает, свеж ли факт кэша.
    for (const file of Object.keys(absolute)) {
      if (!existsSync(file)) {
        writeFileSync(file, '');
      }
    }
    writeFileSync(join(work, 'counts.json'), JSON.stringify(absolute));
    writeFileSync(join(work, 'fake-jest.cjs'), FAKE_JEST);
    writeFileSync(join(work, 'calls.log'), '');
    const cacheDir = join(work, 'node_modules', '.cache', 'jest-test-groups');
    mkdirSync(cacheDir, { recursive: true });
    if (cached) {
      writeFileSync(join(cacheDir, 'counts.json'), JSON.stringify(counts));
    }
    afterCache();
    const result = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--out',
        join(work, 'merged.json'),
        ...flags,
        '--',
        process.execPath,
        'fake-jest.cjs',
        ...jestArgs,
      ],
      {
        cwd: work,
        encoding: 'utf8',
        env: {
          ...process.env,
          FAKE_COUNTS: join(work, 'counts.json'),
          FAKE_LOG: join(work, 'calls.log'),
          JEST_GROUP_MAX_TESTS: '',
          JEST_GROUP_WORKERS: '',
          JEST_GROUPS_KEEP_GOING: '',
          JEST_GROUPS_STRICT: '',
          FAKE_TWICE: '',
          FAKE_HANG: '',
          FAKE_REPORT: '',
          JEST_GROUP_ARGV_BUDGET: '',
          JEST_GROUP_MIN_FREE_MB: '0',
          JEST_GROUP_MAX_LOAD_PERCENT: '1000',
          ...env,
        },
      },
    );
    const read = (path: string): string => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return '';
      }
    };
    const calls = read(join(work, 'calls.log'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Run['calls'][number]);
    const report = read(join(work, 'merged.json'));
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls,
      report: report ? (JSON.parse(report) as Run['report']) : null,
      cache: readCacheTests(work, [process.execPath, 'fake-jest.cjs', ...jestArgs]),
    };
  };
  const groupsOf = (calls: Run['calls']): string[][] =>
    calls
      .filter((call) => call.event === 'start')
      .map((call) => (call.files ?? []).map((file) => file.slice(work.length + 1)));

  it('группы не больше плана (285 при потолке 300); файл тяжелее — группой из одного', () => {
    // Фикстура несёт оба случая: файлы, которые ДОЛЖНЫ сложиться в группу
    // (140 + 145 = ровно план), и файлы, которые НЕ должны (146 + 140).
    const result = run({
      'a.spec.ts': 140,
      'b.spec.ts': 145,
      'c.spec.ts': 146,
      'd.spec.ts': 140,
      'e.spec.ts': 290,
      'f.spec.ts': 1,
    });

    expect(result.status).toBe(0);
    // Упаковка от тяжёлых к лёгким: f (1 тест) ложится к c, а не открывает
    // свою группу; к e (сверх плана) не добавляется ничего.
    expect(groupsOf(result.calls)).toEqual([
      ['e.spec.ts'],
      ['c.spec.ts', 'f.spec.ts'],
      ['a.spec.ts', 'b.spec.ts'],
      ['d.spec.ts'],
    ]);
  });

  it('файл сам больше потолка — группой из одного и отказ с подсказкой разделить его', () => {
    const result = run({ 'a.spec.ts': 400, 'b.spec.ts': 2 });

    expect(groupsOf(result.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('группа 1: 400 тестов (план 400) — файл a.spec.ts один тяжелее потолка');
  });

  it('запас на рост: план держит группу ниже потолка', () => {
    // 290 + 5 укладывается в потолок 300, но не в план 285: файл, подросший
    // между прогонами, не должен вытолкнуть группу за потолок.
    const result = run({ 'a.spec.ts': 290, 'b.spec.ts': 5 });

    expect(groupsOf(result.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(result.stdout).toContain('до 300 тестов, по плану до 285');
  });

  it('группы идут строго по очереди, у каждой не больше 2 воркеров', () => {
    const result = run({ 'a.spec.ts': 200, 'b.spec.ts': 200, 'c.spec.ts': 200 });

    expect(result.calls.map((call) => call.event)).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
    expect(result.calls.filter((call) => call.event === 'start').map((call) => call.workers)).toEqual([
      '--maxWorkers=2',
      '--maxWorkers=2',
      '--maxWorkers=2',
    ]);
  });

  it('отчёт — слияние групп: все файлы и сумма тестов; кэш получает факты', () => {
    const result = run({ 'a.spec.ts': 200, 'b.spec.ts': 200 }, {}, false);

    expect(result.status).toBe(0);
    expect(result.report?.numTotalTests).toBe(400);
    expect(result.report?.testResults).toHaveLength(2);
    expect(result.report?.success).toBe(true);
    // Без истории пустой файл числа тестов не показывает — каждый идёт группой
    // из одного (прежде оба шли одной группой на 400 тестов). Факты — в кэше.
    expect(groupsOf(result.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(result.cache).toEqual({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
    expect(result.stdout).not.toContain('превышен');
  });

  it('файл выборки, которого нет ни в одном отчёте, — отказ', () => {
    const result = run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, { FAKE_DROP: '' });
    const dropped = run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, { FAKE_DROP: join(work, 'b.spec.ts') });

    expect(result.status).toBe(0);
    // Отказ раннера, а не упавшие тесты: свой код.
    expect(dropped.status).toBe(2);
    expect(dropped.stderr).toContain('не выполнены ни в одной группе: b.spec.ts');
  });

  it('упавшая группа останавливает прогон; KEEP_GOING гонит дальше', () => {
    const counts = { 'a.spec.ts': 200, 'b.spec.ts': 200, 'c.spec.ts': 200 };
    const stopped = run(counts, { FAKE_FAIL: join(work, 'b.spec.ts') });

    expect(stopped.status).toBe(1);
    expect(groupsOf(stopped.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(stopped.report?.success).toBe(false);

    const kept = run(counts, {
      FAKE_FAIL: join(work, 'b.spec.ts'),
      JEST_GROUPS_KEEP_GOING: '1',
    });

    expect(kept.status).toBe(1);
    expect(groupsOf(kept.calls)).toHaveLength(3);
  });

  it('файл, выполненный дважды, — отказ с подсказкой про позиционный путь', () => {
    // Позиционный путь в команде jest берёт вместе с путями группы и гонит
    // файл двумя воркерами разом: спеки с общим Redis затирают друг друга, и
    // это выглядит флаком (09.11.2026).
    const result = run({ 'a.spec.ts': 10 }, { FAKE_TWICE: join(work, 'a.spec.ts') });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('выполнены дважды: a.spec.ts');
  });

  it('пустая выборка — отказ, а не зелёный прогон', () => {
    const result = run({});

    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain('пуста');
  });

  /**
   * Факт кэша верен, пока у файла тот же отпечаток (mtime и размер), что был
   * перед прогоном, давшим факт. Файл, в который ПОСЛЕ этого дописали десятки
   * тестов, шёл бы в группу по старому числу и выводил её за потолок (было:
   * 337 при 300).
   */
  it('файл изменён после прогона, давшего факт, — факт плюс прирост видимых тестов с калибровкой', () => {
    const grown = `${Array.from({ length: 300 }, (_, i) => `it('t${i}', () => undefined);`).join('\n')}\n`;
    // Первый прогон даёт факты 10 и 10 с отпечатками файлов.
    expect(run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, {}, false).status).toBe(0);
    writeFileSync(join(work, 'a.spec.ts'), grown);
    const result = run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, {}, false);

    // По факту (10 + 10) спеки шли бы одной группой; прирост 299 видимых
    // тестов выносит выросший файл в отдельную.
    expect(groupsOf(result.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
  });

  it('файл не менялся после прогона — факт из кэша, даже если оценка по тексту выше', () => {
    // Контроль к тесту выше: текст на 300 тестов, но файл не менялся после
    // прогона, давшего факт 10, — верен факт, иначе оценка дробила бы группы.
    const grown = `${Array.from({ length: 300 }, (_, i) => `it('t${i}', () => undefined);`).join('\n')}\n`;
    writeFileSync(join(work, 'a.spec.ts'), grown);
    writeFileSync(join(work, 'b.spec.ts'), '');
    expect(run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, {}, false).status).toBe(0);
    const result = run({ 'a.spec.ts': 10, 'b.spec.ts': 10 }, {}, false);

    expect(groupsOf(result.calls)).toEqual([['a.spec.ts', 'b.spec.ts']]);
  });

  it('кэш до 0.5.0 (общий counts.json) — подсказка для команды без своей истории: нижняя граница', () => {
    // Прежний факт 200 на файл знает только counts.json: каждая спека — своей группой.
    const result = run({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
    expect(groupsOf(result.calls)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(result.cache).toEqual({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
  });

  it('кэш пишется через временный файл и rename: обрезанной записи на диске не бывает', () => {
    expect(run({ 'a.spec.ts': 3 }).status).toBe(0);
    const dir = join(work, 'node_modules', '.cache', 'jest-test-groups');
    const own = readdirSync(dir).find((name) => /^jest-[0-9a-f]{16}\.json$/.test(name)) ?? '';
    const before = statSync(join(dir, own)).ino;
    const result = run({ 'a.spec.ts': 3 });
    expect(result.status).toBe(0);
    // Файл заменён (новый inode), а не дописан на месте; временных файлов не осталось.
    expect(statSync(join(dir, own)).ino).not.toBe(before);
    expect(result.cache).toEqual({ 'a.spec.ts': 3 });
    expect(readdirSync(dir).sort()).toEqual(
      ['counts.json', own, own.replace('.json', '.last-run.json')].sort(),
    );
  });

  it('аргументы сверх потолка — группа делится, каждый запуск в потолке', () => {
    const counts = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`f${String(index).padStart(2, '0')}.spec.ts`, 1]),
    );
    const whole = run(counts);
    expect(groupsOf(whole.calls)).toHaveLength(1);
    const fixed = (whole.calls[0]?.argv ?? 0) - 12 * (join(work, 'f00.spec.ts').length + 1);
    // Потолок — общая часть и четыре пути: при 12 файлах — три запуска (с запасом на номер группы).
    const budget = fixed + 4 * (join(work, 'f00.spec.ts').length + 1) + 40;
    const split = run(counts, { JEST_GROUP_ARGV_BUDGET: String(budget) });

    expect(split.status).toBe(0);
    const groups = groupsOf(split.calls);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups.flat().sort()).toEqual(Object.keys(counts).sort());
    for (const call of split.calls.filter((entry) => entry.event === 'start')) {
      expect(call.argv ?? 0).toBeLessThanOrEqual(budget);
    }
  });

  it('обрезанный отчёт группы — отказ «не JSON», а не «jest не записал отчёт»', () => {
    const truncated = run({ 'a.spec.ts': 2 }, { FAKE_REPORT: 'truncated' });
    expect(truncated.status).toBe(2);
    expect(truncated.stderr).toContain('не JSON');
    expect(truncated.stderr).not.toContain('не записал');
    // Контроль: отчёта нет вовсе — прежняя причина, и она отличима.
    const missing = run({ 'a.spec.ts': 2 }, { FAKE_REPORT: 'none' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('jest не записал отчёт');
  });

  /**
   * Отчёт прошлого прогона удаляется ДО работы: прогон, оборванный раньше
   * записи, иначе оставлял бы на диске зелёный отчёт, и проверка пропусков
   * прочла бы его как свой.
   */
  it('отказ до записи отчёта (пустая выборка) — прошлого зелёного отчёта на диске нет', () => {
    const stale = JSON.stringify({ numTotalTests: 5, success: true, testResults: [] });
    const result = run({}, {}, true, [], [], () => writeFileSync(join(work, 'merged.json'), stale));
    expect(result.status).toBe(2);
    expect(existsSync(join(work, 'merged.json'))).toBe(false);
  });

  it('прошлое слитое покрытие тоже удаляется до работы', () => {
    const target = join(work, 'cov', 'coverage-final.json');
    const result = run({}, {}, true, ['--merge-coverage', target], [], () => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '{"old": {}}');
    });
    expect(result.status).toBe(2);
    expect(existsSync(target)).toBe(false);
  });

  it.each([['--maxWorkers=4'], ['-w'], ['--runInBand'], ['-i'], ['--watch'], ['--shard=1/2'], ['--json']])(
    '%s в команде выборки — отказ до запуска: флаг задаёт раннер',
    (flag) => {
      const result = run({ 'a.spec.ts': 2 }, {}, true, [], [flag]);
      expect(result.status).toBe(2);
      expect(result.calls).toEqual([]);
      expect(result.stderr).toContain(flag.split('=')[0] ?? flag);
    },
  );

  it('контроль: обычные флаги jest (--config, --testPathPatterns) раннер пропускает', () => {
    const result = run({ 'a.spec.ts': 2 }, {}, true, [], ['--testPathPatterns', 'a']);
    expect(result.status).toBe(0);
  });

  it('факт группы больше потолка: по умолчанию отказ, JEST_GROUPS_STRICT=0 — строка в журнале', () => {
    const strict = run({ 'a.spec.ts': 301 });
    expect(strict.status).toBe(2);
    expect(strict.stderr).toContain('потолок факта превышен');
    expect(strict.report?.numTotalTests).toBe(301);
    const loose = run({ 'a.spec.ts': 301 }, { JEST_GROUPS_STRICT: '0' });
    expect(loose.status).toBe(0);
    expect(loose.stdout).toContain('больше 300 тестов вышло в: группа 1: 301 тестов');
    const typo = run({ 'a.spec.ts': 2 }, { JEST_GROUPS_STRICT: 'yes' });
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain('JEST_GROUPS_STRICT — целое число');
  });

  it('упавшие тесты — код 1, отличный от отказа раннера', () => {
    const result = run({ 'a.spec.ts': 2 }, { FAKE_FAIL: join(work, 'a.spec.ts') });
    expect(result.status).toBe(1);
  });

  it('--coverage в команде без слияния — отказ: группы затёрли бы покрытие друг друга', () => {
    const result = run({ 'a.spec.ts': 2 }, {}, true, [], ['--coverage']);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain('--merge-coverage');
  });

  it('--merge-coverage: покрытие всех групп слито в один файл', () => {
    const counts = { 'a.spec.ts': 200, 'b.spec.ts': 200 };
    const target = join(work, 'cov', 'coverage-final.json');
    const result = run(counts, {}, true, ['--merge-coverage', target]);

    expect(result.status).toBe(0);
    expect(groupsOf(result.calls)).toHaveLength(2);
    const merged = JSON.parse(readFileSync(target, 'utf8')) as Record<string, { s: Record<string, number> }>;
    expect(merged['/src/shared.ts']?.s['0']).toBe(2);
    expect(Object.keys(merged).sort()).toEqual(
      ['/src/shared.ts', `${join(work, 'a.spec.ts')}.src`, `${join(work, 'b.spec.ts')}.src`].sort(),
    );
  });

  /**
   * Под Kubernetes и в CI сигнал получает только раннер. С синхронным spawn
   * он не мог его даже принять: jest доигрывал группу сиротой, кэш не
   * сохранялся.
   */
  it('SIGTERM раннеру: пробрасывается jest, следующие группы не идут, кэш сохранён, код 143', async () => {
    const counts = { 'a.spec.ts': 200, 'b.spec.ts': 200, 'c.spec.ts': 200 };
    // Прогон-эталон без зависания — чтобы знать порядок групп.
    const order = groupsOf(run(counts).calls).map((group) => group[0] ?? '');
    const hang = order[1] ?? '';
    const cacheFile = join(work, 'node_modules', '.cache', 'jest-test-groups', 'counts.json');
    // Кэш знает 201 на файл (по одному в группе), фейк отчитается 200: видно,
    // какие факты легли в кэш.
    // Своей истории команды нет (снята после эталона): факты 201 — из прежнего общего кэша.
    for (const name of readdirSync(dirname(cacheFile)).filter((entry) => entry !== 'counts.json')) {
      rmSync(join(dirname(cacheFile), name));
    }
    writeFileSync(cacheFile, JSON.stringify({ 'a.spec.ts': 201, 'b.spec.ts': 201, 'c.spec.ts': 201 }));
    writeFileSync(join(work, 'calls.log'), '');
    rmSync(join(work, 'merged.json'), { force: true });
    const child = spawn(
      process.execPath,
      [RUNNER, '--out', join(work, 'merged.json'), '--', process.execPath, 'fake-jest.cjs'],
      {
        cwd: work,
        env: {
          ...process.env,
          FAKE_COUNTS: join(work, 'counts.json'),
          FAKE_LOG: join(work, 'calls.log'),
          FAKE_HANG: join(work, hang),
          JEST_GROUP_MAX_TESTS: '',
          JEST_GROUP_WORKERS: '',
          JEST_GROUPS_KEEP_GOING: '',
          JEST_GROUPS_STRICT: '',
          JEST_GROUP_ARGV_BUDGET: '',
          JEST_GROUP_MIN_FREE_MB: '0',
          JEST_GROUP_MAX_LOAD_PERCENT: '1000',
          FAKE_TWICE: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    const events = (): { event: string; pid?: number }[] =>
      readFileSync(join(work, 'calls.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event: string; pid?: number });
    try {
      // Сигнал — только когда фейк поставил обработчик (строка hanging после него).
      for (let waited = 0; !events().some((e) => e.event === 'hanging') && waited < 10_000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      child.kill('SIGTERM');
      const status = await exited;

      expect(status).toBe(143);
      expect(events().map((e) => e.event)).toEqual(['start', 'end', 'start', 'hanging', 'term']);
      // Факты первой группы сохранены; прерванная группа не засчитана.
      expect(readCacheTests(work, [process.execPath, 'fake-jest.cjs'])).toEqual({
        'a.spec.ts': 201,
        'b.spec.ts': 201,
        'c.spec.ts': 201,
        [order[0] ?? '']: 200,
      });
      expect(existsSync(join(work, 'merged.json'))).toBe(false);
    } finally {
      // Упавшая проверка не должна оставлять процессы: ни раннер, ни фейк.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      for (const { pid } of events()) {
        RunnerSandbox.killQuietly(pid);
      }
    }
  }, 30_000);
});

describe('jest-groups: сигнал во время выборки', () => {
  it('SIGTERM, пока идёт --listTests, — код 143 (прерывание), а не «выборка не получена»', async () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-list-')));
    const log = join(work, 'calls.log');
    writeFileSync(join(work, 'counts.json'), '{}');
    writeFileSync(join(work, 'fake-jest.cjs'), FAKE_JEST);
    writeFileSync(log, '');
    const child = spawn(
      process.execPath,
      [RUNNER, '--out', join(work, 'merged.json'), '--', process.execPath, 'fake-jest.cjs'],
      {
        cwd: work,
        env: { ...process.env, FAKE_COUNTS: join(work, 'counts.json'), FAKE_LOG: log, FAKE_LIST_HANG: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    const events = (): { event: string; pid?: number }[] =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event: string; pid?: number });
    try {
      for (let waited = 0; !events().some((e) => e.event === 'hanging') && waited < 10_000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      child.kill('SIGTERM');
      expect(await exited).toBe(143);
      expect(stderr).toContain('во время выборки');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      for (const { pid } of events()) {
        RunnerSandbox.killQuietly(pid);
      }
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('jest-groups --plan-only', () => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-plan-spec-')));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  /** План из строки (`null` — файла нет) и запуск раннера на нём. */
  const plan = (content: string | null) => {
    const path = join(work, 'plan.json');
    if (content !== null) {
      writeFileSync(path, content);
    }
    const result = spawnSync(process.execPath, [RUNNER, '--plan-only', path], { encoding: 'utf8' });
    return { path, status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  it('раскладка по плану с запасом: 200 + 200 при потолке 300 — две группы', () => {
    const result = plan(JSON.stringify({ max: 300, counts: { a: 200, b: 200 } }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([['a'], ['b']]);
  });

  it('битый JSON и отсутствующий файл — отказ с путём плана, код 2', () => {
    const broken = plan('{"max": 300, "cou');
    expect(broken.status).toBe(2);
    expect(broken.stderr).toContain(`план ${broken.path} не прочитан`);
    rmSync(broken.path);
    const missing = plan(null);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(`план ${missing.path} не прочитан`);
  });

  // Прежде план без `max` раскладывался молча: потолок NaN, каждый файл —
  // отдельной группой, код 0 — гейт сверял бы раскладку, которой нет.
  it('план не той формы — отказ, а не тихая раскладка', () => {
    for (const content of [{ counts: { a: 1 } }, { max: 300 }, { max: 300, counts: { a: 'many' } }]) {
      const result = plan(JSON.stringify(content));
      expect({ content, status: result.status }).toEqual({ content, status: 2 });
      expect(result.stderr).toContain('не той формы');
    }
  });
});

describe('jest-assert-no-skipped CLI', () => {
  const ASSERT = join(__dirname, '..', '..', 'dist', 'bin', 'jest-assert-no-skipped.js');
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-skipped-spec-')));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  const check = (report: unknown): number | null => {
    writeFileSync(join(work, 'r.json'), JSON.stringify(report));
    return spawnSync(process.execPath, [ASSERT, join(work, 'r.json')], { encoding: 'utf8' }).status;
  };
  // Форма настоящего отчёта jest --json: success и testResults есть всегда.
  const suite = (status: string) => ({
    success: true,
    numTotalTests: 2,
    testResults: [
      {
        name: 'a.spec.ts',
        assertionResults: [
          { status: 'passed', fullName: 'a' },
          { status, fullName: 'b' },
        ],
      },
    ],
  });

  it('без пропусков — код 0', () => {
    expect(check(suite('passed'))).toBe(0);
  });

  it('сьют не загрузился (ошибка в файле, ни одного теста) — код 1, хотя пропусков нет', () => {
    expect(
      check({
        success: false,
        numTotalTests: 2,
        numFailedTestSuites: 1,
        numRuntimeErrorTestSuites: 1,
        testResults: [
          { name: 'a.spec.ts', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'a' }] },
          { name: 'broken.spec.ts', status: 'failed', assertionResults: [] },
        ],
      }),
    ).toBe(1);
  });

  it('пропущенный тест — код 1', () => {
    expect(check(suite('pending'))).toBe(1);
  });

  it('отчёт не читается — код 2 (прогон не дошёл до отчёта), а не стек', () => {
    writeFileSync(join(work, 'r.json'), '{"numTotalTests": 3, "testRes');
    const result = spawnSync(process.execPath, [ASSERT, join(work, 'r.json')], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('не прочитан');
  });

  it('перечень пропусков больше 64 КБ доходит до конца: выход через exitCode, а не process.exit', async () => {
    const tests = Array.from({ length: 3000 }, (_, index) => ({
      status: 'pending',
      fullName: `пропущенный тест номер ${index} ${'x'.repeat(20)}`,
    }));
    writeFileSync(
      join(work, 'r.json'),
      JSON.stringify({
        success: true,
        numTotalTests: 3000,
        testResults: [{ name: 'a.spec.ts', assertionResults: tests }],
      }),
    );
    // Читатель медленнее писателя (CI, который пишет журнал в файл): буфер pipe
    // заполнен, остальное ждёт в очереди процесса — немедленный process.exit()
    // её выбросил бы.
    const child = spawn(process.execPath, [ASSERT, join(work, 'r.json')], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.pause();
    await new Promise((resolve) => setTimeout(resolve, 500));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stderr.resume();
    const status = await new Promise<number | null>((resolve) => child.once('close', resolve));
    expect(status).toBe(1);
    expect(Buffer.byteLength(stderr)).toBeGreaterThan(64 * 1024);
    expect(stderr).toContain('пропущенный тест номер 2999');
  });

  it('пустой отчёт — код 1: «пропусков нет» не равно «тестов не найдено»', () => {
    expect(check({ numTotalTests: 0, testResults: [] })).toBe(1);
  });
});
