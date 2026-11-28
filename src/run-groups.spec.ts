import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { cacheKey } from './cache/cache-key';
import { JestGroupsError } from './jest-groups.error';
import { mergeShardReports } from './merge-shard-reports';
import { runGroups } from './run-groups';
import { FakeToolRunner } from './testing/fake-tool-runner';
import type { MachineLoad } from './types/machine-load.type';
import type { ProcessResult, ProcessRunner } from './types/process-runner.type';
import type { RunGroupsOptions } from './types/run-groups-options.type';

/**
 * Оркестровка раннера в процессе спеки: поддельный порт запуска вместо
 * процессов. Так каждая ветка `runGroups` проверяется без сборки и без
 * дочерних процессов — и доступна мутационному прогону (прежде run-groups.ts
 * исполнялся только через собранный CLI, и мутанты в нём не проверялись).
 */
describe('runGroups', () => {
  let root = '';
  let fake: FakeToolRunner;
  let lines: string[];
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-run-')));
    fake = new FakeToolRunner();
    lines = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const specs = (counts: Record<string, number>): void => {
    fake.counts = {};
    for (const [file, tests] of Object.entries(counts)) {
      if (!existsSync(join(root, file))) {
        writeFileSync(join(root, file), '');
      }
      fake.counts[join(root, file)] = tests;
    }
  };
  const options = (over: Partial<RunGroupsOptions> = {}): RunGroupsOptions => ({
    command: ['jest'],
    out: join(root, 'out', 'report.json'),
    cwd: root,
    maxTests: 300,
    workers: 2,
    keepGoing: false,
    dryRun: false,
    run: fake.run,
    log: (line) => lines.push(line),
    typescript: null,
    ...over,
  });
  const relGroups = (): string[][] =>
    fake.groups().map((group) => group.map((file) => file.slice(root.length + 1)));
  const report = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(root, 'out', 'report.json'), 'utf8')) as Record<string, unknown>;
  const failure = async (promise: Promise<void>): Promise<JestGroupsError> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof JestGroupsError) {
        return error;
      }
      throw error;
    }
    throw new Error('ожидался отказ раннера');
  };
  /** Прогон «полного набора», чтобы кэш знал факты, — три группы по 200. */
  const three = async (): Promise<void> => {
    specs({ 'a.spec.ts': 200, 'b.spec.ts': 200, 'c.spec.ts': 200 });
    await runGroups(options());
    fake.reset();
    await runGroups(options());
  };

  describe('возобновление', () => {
    it('--failed-only гонит упавшую и не запускавшиеся группы того же плана; отчёт — частичный', async () => {
      await three();
      const plan = relGroups();
      expect(plan).toHaveLength(3);
      fake.failing.add(join(root, plan[1]?.[0] ?? ''));
      fake.reset();
      expect((await failure(runGroups(options()))).exitCode).toBe(1);
      // Третья группа не запускалась: остановка на первой упавшей.
      expect(relGroups()).toEqual(plan.slice(0, 2));
      fake.failing.clear();
      fake.reset();

      await runGroups(options({ resume: { failedOnly: true } }));

      expect(relGroups()).toEqual(plan.slice(1));
      expect(report().jestGroups).toEqual({ tool: 'jest', groups: 2, partial: 'failed-only' });
      expect(report().numTotalTests).toBe(400);
      // Состояние обновлено: повторное --failed-only гнать нечего.
      fake.reset();
      await runGroups(options({ resume: { failedOnly: true } }));
      expect(relGroups()).toEqual([]);
      expect(lines.some((line) => line.includes('все группы прошлого прогона прошли'))).toBe(true);
      expect(report().numTotalTests).toBe(0);
    });

    it('--from-group N — с группы N до конца прошлого плана', async () => {
      await three();
      const plan = relGroups();
      fake.reset();
      await runGroups(options({ resume: { fromGroup: 3 } }));
      expect(relGroups()).toEqual(plan.slice(2));
      expect(report().jestGroups).toEqual({ tool: 'jest', groups: 1, partial: 'from-group 3' });
    });

    it('нет состояния, план устарел, номер за планом — отказ', async () => {
      specs({ 'a.spec.ts': 2 });
      expect((await failure(runGroups(options({ resume: { failedOnly: true } })))).message).toContain(
        'состояния прошлого полного прогона этой команды нет',
      );
      await runGroups(options());
      expect((await failure(runGroups(options({ resume: { fromGroup: 2 } })))).message).toContain(
        '--from-group 2: в прошлом плане групп 1',
      );
      specs({ 'b.spec.ts': 2 });
      expect((await failure(runGroups(options({ resume: { failedOnly: true } })))).message).toContain(
        'план прошлого прогона устарел — файлов нет в выборке: a.spec.ts',
      );
    });

    it('частичный прогон (только изменённое) состояния полного не портит', async () => {
      await three();
      const plan = relGroups();
      specs({ 'a.spec.ts': 200 });
      await runGroups(options({ changedSince: 'main' }));
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 200, 'c.spec.ts': 200 });
      fake.reset();
      await runGroups(options({ resume: { fromGroup: 1 } }));
      expect(relGroups()).toEqual(plan);
    });
  });

  describe('только изменённое', () => {
    it('ссылка уходит в выборку, а не в группы; группы — обычный план', async () => {
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
      for (const file of ['a.spec.ts', 'b.spec.ts']) {
        writeFileSync(join(root, file), "it('t', f);\n".repeat(200));
      }
      await runGroups(options({ changedSince: 'origin/main' }));
      const listing = fake.calls.find((call) => call.args.includes('--listTests'));
      expect(listing?.args).toContain('--changedSince=origin/main');
      expect(fake.groups()).toHaveLength(2);
      for (const call of fake.calls.filter((entry) => entry.args.includes('--runTestsByPath'))) {
        expect(call.args.join(' ')).not.toContain('changedSince');
      }
      expect(report().jestGroups).toEqual({
        tool: 'jest',
        groups: 2,
        partial: 'changed-since origin/main',
      });
    });

    it('изменённых нет — код 0 и пустой частичный отчёт; без флага пустая выборка — отказ', async () => {
      specs({});
      await runGroups(options({ changedSince: 'HEAD' }));
      expect(report()).toEqual({
        numTotalTests: 0,
        numTotalTestSuites: 0,
        success: true,
        testResults: [],
        jestGroups: { tool: 'jest', groups: 0, partial: 'changed-since HEAD' },
      });
      expect((await failure(runGroups(options()))).message).toContain('пуста');
    });

    it('изменённых нет, шарды: у каждого пустая раскладка — jest-groups-merge склеит их в пустой частичный', async () => {
      specs({});
      const shards = [];
      for (const index of [1, 2]) {
        await runGroups(options({ changedSince: 'HEAD', shard: { index, count: 2 } }));
        shards.push({ path: `shard-${index}`, report: report() as never });
      }
      const metas = shards.map(
        (shard) => (shard.report as { jestGroups: Record<string, unknown> }).jestGroups,
      );
      expect(metas[0]).toMatchObject({ shard: '1/2', files: [], partial: 'changed-since HEAD, shard 1/2' });
      expect(typeof metas[0]?.plan).toBe('string');
      expect(metas[0]?.plan).toBe(metas[1]?.plan);
      expect(mergeShardReports(shards).jestGroups).toEqual({
        tool: 'jest',
        groups: 0,
        shards: 2,
        partial: 'changed-since HEAD',
      });
    });
  });

  describe('шардирование', () => {
    it('шарды вместе — вся выборка ровно по разу, отпечаток плана одинаков', async () => {
      const counts = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`s${index}.spec.ts`, 1]));
      specs(counts);
      for (const file of Object.keys(counts)) {
        writeFileSync(join(root, file), "it('a', f);\n".repeat(1 + Number(file.slice(1, 2))));
      }
      const ran: string[] = [];
      const prints: string[] = [];
      for (const index of [1, 2, 3]) {
        fake.reset();
        lines = [];
        await runGroups(options({ shard: { index, count: 3 } }));
        const shardFiles = relGroups().flat().sort();
        ran.push(...shardFiles);
        prints.push(lines.find((line) => line.includes('план '))?.replace(/.* план /, '') ?? '');
        // Шард — часть набора: без пометки jest-assert-no-skipped принял бы
        // отчёт одной машины за проверку всего набора.
        // Отпечаток плана и файлы шарда — для jest-groups-merge.
        const print = lines.find((line) => line.includes('план '))?.replace(/.* план /, '');
        expect(report().jestGroups).toEqual({
          tool: 'jest',
          groups: 1,
          partial: `shard ${index}/3`,
          shard: `${index}/3`,
          plan: print,
          files: shardFiles,
        });
      }
      expect(ran.sort()).toEqual(Object.keys(counts).sort());
      expect(new Set(prints).size).toBe(1);
    });

    it('шард 1/1 — весь набор: отчёт не частичный', async () => {
      specs({ 'a.spec.ts': 1, 'b.spec.ts': 1 });
      await runGroups(options({ shard: { index: 1, count: 1 } }));
      expect(relGroups().flat().sort()).toEqual(['a.spec.ts', 'b.spec.ts']);
      const meta = report().jestGroups;
      expect(meta).toMatchObject({ tool: 'jest', shard: '1/1' });
      expect(meta).not.toHaveProperty('partial');
    });

    it('шард вместе с «только изменённым» — в пометке обе причины', async () => {
      specs({ 'a.spec.ts': 1, 'b.spec.ts': 1 });
      await runGroups(options({ changedSince: 'origin/main', shard: { index: 1, count: 2 } }));
      expect(report().jestGroups).toMatchObject({
        tool: 'jest',
        partial: 'changed-since origin/main, shard 1/2',
        shard: '1/2',
      });
    });

    it('шардов больше, чем файлов, и номер за пределом — отказ', async () => {
      specs({ 'a.spec.ts': 1 });
      expect((await failure(runGroups(options({ shard: { index: 2, count: 2 } })))).message).toContain(
        'шард 2/2 пуст',
      );
      expect((await failure(runGroups(options({ shard: { index: 3, count: 2 } })))).message).toContain(
        '--shard 3/2',
      );
    });
  });

  describe('потолки и защита машины', () => {
    it('группа снята по времени — отказ раннера, отчёт не записан, остальные не запускались', async () => {
      await three();
      fake.reset();
      fake.outcomes.set(2, 'timeout');
      const error = await failure(runGroups(options({ limits: { timeoutMs: 5_000 } })));
      expect({ code: error.exitCode, message: error.message }).toEqual({
        code: 2,
        message:
          'группа 2: снята по потолку времени 5 с (JEST_GROUP_TIMEOUT_S) — зависший тест или незакрытый дескриптор; ' +
          'кэш сохранён, отчёт не записан',
      });
      expect(fake.groups()).toHaveLength(2);
      expect(existsSync(join(root, 'out', 'report.json'))).toBe(false);
      // Потолок передан процессу группы.
      expect(fake.calls.filter((call) => call.args.includes('--runTestsByPath'))[0]?.options?.timeoutMs).toBe(
        5_000,
      );
    });

    it('группа снята по памяти — отказ с потолком в МБ', async () => {
      specs({ 'a.spec.ts': 2 });
      fake.outcomes.set(1, 'memory');
      expect(
        (await failure(runGroups(options({ limits: { maxRssBytes: 512 * 2 ** 20 } })))).message,
      ).toContain('группа 1: снята по потолку памяти 512 МБ (JEST_GROUP_MAX_RSS_MB)');
    });

    it('перед КАЖДОЙ группой — проверка нормы машины; не пришла — ни одной группы', async () => {
      await three();
      fake.reset();
      let probes = 0;
      const free: MachineLoad = { freeBytes: 8 * 2 ** 30, totalBytes: 16 * 2 ** 30, load1: 1, cores: 8 };
      const machine = {
        minFreeBytes: 2 ** 30,
        maxLoadPercent: 150,
        maxWaitMs: 1_000,
        pollMs: 500,
        probe: () => {
          probes++;
          return free;
        },
        sleep: async () => undefined,
        now: () => 0,
      };
      await runGroups(options({ machine }));
      expect(probes).toBe(3);

      fake.reset();
      let clock = 0;
      const busy = {
        ...machine,
        probe: () => ({ ...free, load1: 100 }),
        sleep: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      };
      expect((await failure(runGroups(options({ machine: busy })))).message).toContain(
        'машина не пришла в норму за 1 с',
      );
      expect(fake.groups()).toEqual([]);
    });

    it('подозрение на зависание: порог — 4 × ожидаемого времени группы, не меньше минуты', async () => {
      await three();
      const call = fake.calls.find((entry) => entry.args.includes('--runTestsByPath'));
      // Факт кэша: 200 тестов по 10 мс = 2 с; 4 × 2 с < 60 с — порог минута.
      expect(call?.options?.stallAfterMs).toBe(60_000);
      call?.options?.onStall?.(60_000);
      expect(lines).toContain(
        '[группы jest] группа 1 идёт 60 с при ожидаемых 2 с — похоже на зависший тест (потолок — JEST_GROUP_TIMEOUT_S)',
      );
    });

    it('потолок длительности по плану: тесты по числу в одну группу, по времени — в две', async () => {
      specs({ 'a.spec.ts': 100, 'b.spec.ts': 100 });
      for (const file of ['a.spec.ts', 'b.spec.ts']) {
        writeFileSync(join(root, file), "it('t', f);\n".repeat(100));
      }
      await runGroups(options());
      expect(fake.groups()).toHaveLength(1);
      fake.reset();
      // Кэш знает по 1 с на файл; потолок 1.5 с разводит их.
      await runGroups(options({ limits: { maxDurationMs: 1_500 } }));
      expect(fake.groups()).toHaveLength(2);
    });

    it('процессы, оставшиеся после группы, названы в журнале; пик памяти — в строке группы', async () => {
      specs({ 'a.spec.ts': 2 });
      fake.leftovers = true;
      await runGroups(options());
      expect(lines).toContain(
        '[группы jest] после группы 1 в её группе процессов остались процессы — сняты (утечка из теста?)',
      );
      expect(
        lines.some((line) => line.startsWith('[группа 1, 1/1]') && line.endsWith('память до 300 МБ')),
      ).toBe(true);
    });
  });

  describe('план по устаревшему кэшу: потолок — предел ФАКТА', () => {
    /** `n` вызовов `it`, видимых оценке по тексту. */
    const visible = (n: number, tag = 'v'): string =>
      Array.from({ length: n }, (_, index) => `it('${tag}${index}', f);\n`).join('');
    /** Таблица из переменной: оценка по тексту её строк не видит. */
    const table = (rows: number): string =>
      `const CASES = [\n${Array.from({ length: rows }, (_, index) => `  ['r${index}'],\n`).join('')}];\n` +
      "it.each(CASES)('%s', f);\n";
    /** Текст ровно `size` байт: хвост — комментарий, чтобы правка не меняла размер. */
    const padded = (text: string, size: number): string => {
      const room = size - Buffer.byteLength(text) - 4;
      if (room < 0) {
        throw new Error(`фикстура длиннее ${size} байт`);
      }
      return `${text}// ${'x'.repeat(room)}\n`;
    };
    /** Правка файла с заведомо другим mtime (часы файловой системы не участвуют). */
    const edit = (file: string, text: string): void => {
      const path = join(root, file);
      const before = statSync(path).mtimeMs;
      writeFileSync(path, text);
      utimesSync(path, new Date(before + 60_000), new Date(before + 60_000));
    };
    const cacheEntry = (file: string): Record<string, unknown> | undefined =>
      (
        JSON.parse(
          readFileSync(
            join(root, 'node_modules', '.cache', 'jest-test-groups', `${cacheKey('jest', ['jest'])}.json`),
            'utf8',
          ),
        ) as { files: Record<string, Record<string, unknown>> }
      ).files[file];
    /** Два прогона: кэш знает факты, план — по ним. a — 150 видимых, b — 10 видимых и 120 строк таблицы. */
    const known = async (bText: string): Promise<void> => {
      specs({ 'a.spec.ts': 150, 'b.spec.ts': 130 });
      writeFileSync(join(root, 'a.spec.ts'), visible(150));
      writeFileSync(join(root, 'b.spec.ts'), bText);
      await runGroups(options());
      fake.reset();
      lines = [];
      await runGroups(options());
      // Контроль: кэш верен — план равен факту (150 + 130 = 280 ≤ 285), одна группа, без строк о превышении.
      expect(relGroups()).toEqual([['a.spec.ts', 'b.spec.ts']]);
      expect(lines.filter((line) => line.includes('вышло'))).toEqual([]);
      fake.reset();
      lines = [];
    };

    it('в недооценённый файл добавили видимые тесты, размер прежний — план растёт с калибровкой файла', async () => {
      // Так было дважды: факт кэша 130, оценка по тексту 11 (таблица не видна);
      // +25 тестов давали план max(130, 1.25 × 36) = 130, группа выходила 305.
      await known(padded(visible(10) + table(120), 4_000));
      edit('b.spec.ts', padded(visible(10) + visible(25, 'n') + table(120), 4_000));
      fake.counts[join(root, 'b.spec.ts')] = 155;

      await runGroups(options());

      expect(relGroups()).toEqual([['b.spec.ts'], ['a.spec.ts']]);
      expect(lines.filter((line) => line.includes('вышло'))).toEqual([]);
    });

    it('в таблицу добавили строки, оценка по тексту прежняя — план растёт с размером файла', async () => {
      await known(visible(10) + table(120));
      edit('b.spec.ts', visible(10) + table(155));
      fake.counts[join(root, 'b.spec.ts')] = 165;

      await runGroups(options());

      expect(relGroups()).toEqual([['b.spec.ts'], ['a.spec.ts']]);
      expect(lines.filter((line) => line.includes('вышло'))).toEqual([]);
    });

    it('ложное срабатывание: файл только тронут (mtime другой, текст тот же) — план равен факту', async () => {
      // c переоценён текстом (140 видимых, факт 130): прежнее «большее из факта и
      // оценки × 1.25» дало бы 175 и лишнюю группу на каждый git checkout.
      specs({ 'a.spec.ts': 150, 'c.spec.ts': 130 });
      writeFileSync(join(root, 'a.spec.ts'), visible(150));
      writeFileSync(join(root, 'c.spec.ts'), visible(140));
      await runGroups(options());
      fake.reset();
      await runGroups(options());
      expect(relGroups()).toEqual([['a.spec.ts', 'c.spec.ts']]);
      edit('c.spec.ts', visible(140));
      fake.reset();
      lines = [];

      await runGroups(options({ dryRun: true }));

      expect(lines).toContain('группа 1: файлов 2, тестов по плану 280');
    });

    it.each([
      ['таблица из переменной', "it.each(ROWS)('%s', f);\n"],
      ['ни одного видимого теста (тесты строит помощник)', 'rules.all(config);\n'],
    ])(
      'файл без истории, число тестов которого текст не показывает (%s), — группой из одного',
      async (_case, text) => {
        specs({ 'a.spec.ts': 150, 'd.spec.ts': 200 });
        writeFileSync(join(root, 'a.spec.ts'), visible(150));
        writeFileSync(join(root, 'd.spec.ts'), text);

        await runGroups(options());

        expect(relGroups()).toEqual([['d.spec.ts'], ['a.spec.ts']]);
      },
    );

    it('после прогона — сверка факта с потолком: превышение названо по файлам, отказ после ВСЕХ групп, кэш обновлён', async () => {
      // a и b недооценены текстом (140 и 80 видимых против 200 и 150): план 275, факт 350.
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 150, 'c.spec.ts': 40 });
      writeFileSync(join(root, 'a.spec.ts'), visible(140));
      writeFileSync(join(root, 'b.spec.ts'), visible(80));
      writeFileSync(join(root, 'c.spec.ts'), visible(40));

      const error = await failure(runGroups(options()));

      expect(relGroups()).toEqual([['a.spec.ts', 'b.spec.ts'], ['c.spec.ts']]);
      expect(error.exitCode).toBe(2);
      expect(error.message).toContain(
        'группа 1: 350 тестов (план 275) — больше плана: a.spec.ts 200 (план 175), b.spec.ts 150 (план 100)',
      );
      // Строка — сразу после группы, а не только в итоге.
      expect(lines.findIndex((line) => line.includes('группа 1: 350 тестов'))).toBeLessThan(
        lines.findIndex((line) => line.startsWith('[группа 2,')),
      );
      expect(report().numTotalTests).toBe(390);
      expect([cacheEntry('a.spec.ts')?.tests, cacheEntry('c.spec.ts')?.tests]).toEqual([200, 40]);
      // Следующий план — по фактам: без превышения и без отказа.
      fake.reset();
      lines = [];
      await runGroups(options());
      expect(relGroups()).toEqual([['a.spec.ts', 'c.spec.ts'], ['b.spec.ts']]);
    });

    it('превышение при выключенной строгости (strictCeiling: false) — строка в журнале, код 0', async () => {
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 150 });
      writeFileSync(join(root, 'a.spec.ts'), visible(140));
      writeFileSync(join(root, 'b.spec.ts'), visible(80));

      await runGroups(options({ strictCeiling: false }));

      expect(lines.some((line) => line.includes('группа 1: 350 тестов (план 275)'))).toBe(true);
    });

    it('упали тесты И превышен потолок — код 1 (упавшие тесты), превышение в журнале', async () => {
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 150 });
      writeFileSync(join(root, 'a.spec.ts'), visible(140));
      writeFileSync(join(root, 'b.spec.ts'), visible(80));
      fake.failing.add(join(root, 'a.spec.ts'));

      const error = await failure(runGroups(options()));

      expect(error.exitCode).toBe(1);
      expect(lines.some((line) => line.includes('группа 1: 350 тестов (план 275)'))).toBe(true);
    });

    it('возобновление по старому плану, когда файл вырос, — отказ до запуска: нужен полный прогон', async () => {
      await known(padded(visible(10) + table(120), 4_000));
      edit('b.spec.ts', padded(visible(10) + visible(25, 'n') + table(120), 4_000));
      fake.counts[join(root, 'b.spec.ts')] = 155;

      const error = await failure(runGroups(options({ resume: { fromGroup: 1 } })));

      expect(error.message).toContain('группа 1 прошлого плана вышла бы за потолок 300');
      expect(error.message).toContain('нужен полный прогон');
      expect(fake.groups()).toEqual([]);
    });

    it('потолок длительности: ожидаемое время выросшего файла растёт вместе с числом тестов', async () => {
      specs({ 'a.spec.ts': 10, 'b.spec.ts': 10 });
      writeFileSync(join(root, 'a.spec.ts'), visible(10));
      writeFileSync(join(root, 'b.spec.ts'), visible(10));
      await runGroups(options());
      fake.reset();
      // Кэш: по 100 мс на файл; потолок 250 мс вмещает оба.
      await runGroups(options({ limits: { maxDurationMs: 250 } }));
      expect(relGroups()).toEqual([['a.spec.ts', 'b.spec.ts']]);
      edit('a.spec.ts', visible(20));
      fake.counts[join(root, 'a.spec.ts')] = 20;
      fake.reset();

      await runGroups(options({ limits: { maxDurationMs: 250 } }));

      // 200 мс (вдвое больше тестов) + 100 мс > 250 мс.
      expect(relGroups()).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    });

    it('в кэш с фактом ложится оценка по тексту того же содержимого — калибровка следующего плана', async () => {
      await known(visible(10) + table(120));
      // Оценка без TypeScript: 10 видимых + it.each = 11; факт 130.
      expect(cacheEntry('b.spec.ts')).toMatchObject({ tests: 130, estimate: 11 });
      expect(cacheEntry('a.spec.ts')).toMatchObject({ tests: 150, estimate: 150 });
    });

    it('пока файл не менялся, оценка из записи переносится, а не пересчитывается (калибровка привязана к содержимому)', async () => {
      await known(visible(10) + table(120));
      const path = join(
        root,
        'node_modules',
        '.cache',
        'jest-test-groups',
        `${cacheKey('jest', ['jest'])}.json`,
      );
      const cache = JSON.parse(readFileSync(path, 'utf8')) as {
        files: Record<string, Record<string, unknown>>;
      };
      // Оценка, записанная прошлой версией оценщика, отличается от нынешней (11).
      cache.files['b.spec.ts'] = { ...cache.files['b.spec.ts'], estimate: 7 };
      writeFileSync(path, JSON.stringify(cache));

      await runGroups(options());

      expect(cacheEntry('b.spec.ts')).toMatchObject({ tests: 130, estimate: 7 });
    });
  });

  describe('сверка отчёта', () => {
    it('файл в двух проектах jest: две копии в своей группе — законно, факт — сумма', async () => {
      specs({ 'a.spec.ts': 3, 'b.spec.ts': 1 });
      fake.copies[join(root, 'a.spec.ts')] = 2;
      fake.projects = 2;
      await runGroups(options());
      expect(report().numTotalTests).toBe(7);
      const cache = JSON.parse(
        readFileSync(
          join(root, 'node_modules', '.cache', 'jest-test-groups', `${cacheKey('jest', ['jest'])}.json`),
          'utf8',
        ),
      ) as { files: Record<string, { tests: number }> };
      expect(cache.files['a.spec.ts']?.tests).toBe(6);
      // Число проектов спрошено у jest один раз — только когда копия встретилась.
      expect(fake.calls.filter((call) => call.args.includes('--showConfig'))).toHaveLength(1);
    });

    it('две копии при одном проекте — позиционный путь в команде: отказ «выполнены дважды»', async () => {
      specs({ 'a.spec.ts': 3 });
      fake.copies[join(root, 'a.spec.ts')] = 2;
      expect((await failure(runGroups(options()))).message).toContain('выполнены дважды: a.spec.ts');
    });

    it('путь спеки в самой команде jest — отказ ДО запуска групп, а не после двойного прогона', async () => {
      // Позиционный путь jest берёт ВМЕСТЕ с путями группы: файл гонится
      // дважды, двумя воркерами разом. Отказ после прогона — уже поздно:
      // двойная нагрузка на машину случилась (замер 15.11: 8 тестов вместо 4).
      specs({ 'a.spec.ts': 3, 'b.spec.ts': 2 });
      const error = await failure(runGroups(options({ command: ['jest', 'a.spec.ts', './b.spec.ts'] })));
      expect(error.message).toContain('пути спек в команде jest: a.spec.ts, b.spec.ts');
      expect(fake.groups()).toEqual([]);
    });

    it('позиционный аргумент, не являющийся спекой выборки (каталог), — не отказ', async () => {
      specs({ 'a.spec.ts': 3 });
      await runGroups(options({ command: ['jest', '.'] }));
      expect(fake.groups()).toHaveLength(1);
    });

    it('файл не своей группы в отчёте — отказ (фильтр путей захватил чужой файл)', async () => {
      specs({ 'a.spec.ts': 3 });
      writeFileSync(join(root, 'stray.spec.ts'), '');
      fake.extra = [join(root, 'stray.spec.ts')];
      expect((await failure(runGroups(options()))).message).toContain(
        'файлы выполнены не в своей группе: stray.spec.ts',
      );
    });

    it('покрытие, включённое конфигом, без слияния — отказ с объяснением', async () => {
      specs({ 'a.spec.ts': 3 });
      fake.reportExtra = { coverageMap: {} };
      expect((await failure(runGroups(options()))).message).toContain('покрытие собирается конфигом проекта');
    });

    it('JUnit по всем группам — один файл', async () => {
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
      await runGroups(options({ junitTo: join(root, 'out', 'junit.xml') }));
      const xml = readFileSync(join(root, 'out', 'junit.xml'), 'utf8');
      expect(xml).toContain(
        '<testsuites name="jest-groups" tests="400" failures="0" errors="0" skipped="0">',
      );
      expect(xml.match(/<testsuite /g)).toHaveLength(2);
    });
  });

  describe('порог покрытия по слитому покрытию', () => {
    /** Покрытие группы: каждый её файл покрывает свой исходник, чужие — нет. */
    const coverage = (sources: Record<string, string>) => (files: readonly string[]) =>
      Object.fromEntries(
        Object.entries(sources).map(([spec, source]) => [
          source,
          {
            path: source,
            statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
            s: { 0: files.includes(spec) ? 1 : 0, 1: files.includes(spec) ? 1 : 0 },
            f: {},
            b: {},
          },
        ]),
      );

    beforeEach(() => {
      specs({ 'a.spec.ts': 200, 'b.spec.ts': 200 });
      // Текст на 200 тестов: оценка 250 разводит спеки по группам уже в первом прогоне.
      for (const file of ['a.spec.ts', 'b.spec.ts']) {
        writeFileSync(join(root, file), "it('t', f);\n".repeat(200));
      }
      fake.coverageOf = coverage({
        [join(root, 'a.spec.ts')]: '/src/a.ts',
        [join(root, 'b.spec.ts')]: '/src/b.ts',
      });
    });

    it('каждая группа видит 50 %, слитое — 100 %: порог 90 % выполнен; в группах порог снят', async () => {
      fake.threshold = { global: { lines: 90 } };
      await runGroups(options({ mergeCoverageTo: join(root, 'cov', 'coverage-final.json') }));
      expect(fake.groups()).toHaveLength(2);
      for (const call of fake.calls.filter((entry) => entry.args.includes('--runTestsByPath'))) {
        expect(call.args).toContain('--coverageThreshold={}');
      }
    });

    it.each([
      ['30.3.0', 'Jest: "global" coverage threshold for lines (90%) not met: 50%'],
      ['30.5.2', 'Jest: Coverage for lines (50%) does not meet "global" threshold (90%)'],
      [undefined, 'Jest: Coverage for lines (50%) does not meet "global" threshold (90%)'],
    ])(
      'слитое ниже порога — отказ (код 1) тем же текстом, что у jest %s из --showConfig',
      async (version, message) => {
        fake.threshold = { global: { lines: 90 } };
        fake.version = version;
        fake.coverageOf = coverage({ [join(root, 'a.spec.ts')]: '/src/a.ts', '/никем': '/src/b.ts' });
        const error = await failure(
          runGroups(options({ mergeCoverageTo: join(root, 'cov', 'coverage-final.json') })),
        );
        expect({ code: error.exitCode, message: error.message }).toEqual({ code: 1, message });
      },
    );

    it('частичный прогон — порог не сверяется, и это названо', async () => {
      fake.threshold = { global: { lines: 90 } };
      fake.coverageOf = coverage({ [join(root, 'a.spec.ts')]: '/src/a.ts', '/никем': '/src/b.ts' });
      await runGroups(options({ mergeCoverageTo: join(root, 'cov', 'c.json'), changedSince: 'main' }));
      expect(lines).toContain('[группы jest] порог покрытия не сверяется: прогон покрыл не весь набор');
    });

    it('шард из двух видит 50 % — порог не сверяется; шард 1/1 — весь набор, порог сверяется', async () => {
      fake.threshold = { global: { lines: 90 } };
      fake.coverageOf = coverage({ [join(root, 'a.spec.ts')]: '/src/a.ts', '/никем': '/src/b.ts' });
      await runGroups(
        options({ mergeCoverageTo: join(root, 'cov', 'c.json'), shard: { index: 1, count: 2 } }),
      );
      expect(lines).toContain('[группы jest] порог покрытия не сверяется: прогон покрыл не весь набор');

      const error = await failure(
        runGroups(options({ mergeCoverageTo: join(root, 'cov', 'c.json'), shard: { index: 1, count: 1 } })),
      );
      expect(error.exitCode).toBe(1);
      expect(error.message).toContain('threshold (90%)');
    });
  });

  describe('слияние покрытия vitest (--merge-reports)', () => {
    /** Поддельный vitest: выборка, группа (отчёт и blob), слияние — по заданному исходу. */
    const vitest =
      (merge: ProcessResult): ProcessRunner =>
      async (_executable, args) => {
        const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
        if (args.includes('list')) {
          return { status: 0, stdout: JSON.stringify([{ file: join(root, 'a.test.js') }]) };
        }
        if (args.some((arg) => arg.startsWith('--merge-reports='))) {
          const dir = value('--coverage.reportsDirectory=') ?? '';
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'coverage-final.json'), '{}');
          writeFileSync(
            value('--outputFile.json=') ?? '',
            JSON.stringify({ success: true, testResults: [] }),
          );
          return merge;
        }
        const blob = value('--outputFile.blob=') ?? '';
        mkdirSync(dirname(blob), { recursive: true });
        writeFileSync(blob, 'blob');
        writeFileSync(
          value('--outputFile.json=') ?? '',
          JSON.stringify({
            success: true,
            numTotalTests: 1,
            testResults: [
              { name: join(root, 'a.test.js'), assertionResults: [{ status: 'passed', fullName: 'a' }] },
            ],
          }),
        );
        return { status: 0, stdout: '', outcome: 'exited' };
      };
    const runVitest = (merge: ProcessResult) => {
      writeFileSync(join(root, 'a.test.js'), "it('a', f);\n");
      return runGroups(
        options({ tool: 'vitest', run: vitest(merge), mergeCoverageTo: join(root, 'cov', 'c.json') }),
      );
    };

    it('слияние снято по потолку времени — отказ раннера с причиной, а не «порог не выполнен»', async () => {
      const error = await failure(runVitest({ status: null, stdout: '', outcome: 'timeout' }));
      expect(error.exitCode).toBe(2);
      expect(error.message).toContain('слияние покрытия (vitest --merge-reports) снято по потолку времени');
    });

    it('код 1 при зелёных тестах — порог не выполнен (код 1); код 0 — покрытие записано', async () => {
      const failed = await failure(runVitest({ status: 1, stdout: '', outcome: 'exited' }));
      expect(failed.exitCode).toBe(1);
      expect(failed.message).toContain('порог покрытия не выполнен');
      await runVitest({ status: 0, stdout: '', outcome: 'exited' });
      expect(existsSync(join(root, 'cov', 'c.json'))).toBe(true);
    });
  });

  describe('подсчёт без выполнения (--collect-tests)', () => {
    const collectCalls = () => fake.calls.filter((call) => call.args.includes('--collectTests'));

    it('пачки не длиннее бюджета командной строки — как группы', async () => {
      // Длинный каталог — чтобы пути не влезли в одну пачку и на системе с коротким tmp (Linux CI).
      const deep = 'd'.repeat(120);
      mkdirSync(join(root, deep));
      specs(Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`${deep}/s${index}.spec.ts`, 2])));
      const budget = 700;
      await runGroups(options({ collectTests: true, argvBudgetBytes: budget }));
      const calls = collectCalls();
      expect(calls.length).toBeGreaterThan(1);
      for (const call of calls) {
        const bytes = ['jest', ...call.args].reduce((total, arg) => total + Buffer.byteLength(arg) + 1, 0);
        expect(bytes).toBeLessThanOrEqual(budget);
      }
      expect(
        calls.flatMap((call) => call.args.slice(call.args.indexOf('--runTestsByPath') + 1)),
      ).toHaveLength(6);
    });

    it('подсчёт не собирает покрытие: флаги покрытия команды сняты, --coverage=false', async () => {
      specs({ 'a.spec.ts': 2 });
      fake.coverageOf = () => ({});
      await runGroups(
        options({
          collectTests: true,
          command: ['jest', '--coverage', '--coverageThreshold={"global":{"lines":1}}'],
          mergeCoverageTo: join(root, 'cov', 'c.json'),
        }),
      );
      const [call] = collectCalls();
      expect(call?.args).toContain('--coverage=false');
      expect(call?.args).not.toContain('--coverage');
      expect(call?.args.some((arg) => arg.startsWith('--coverageThreshold'))).toBe(false);
    });

    it('пробный прогон файлы не загружает: подсчёт пропущен, и это названо', async () => {
      specs({ 'a.spec.ts': 2 });
      await runGroups(options({ collectTests: true, dryRun: true }));
      expect(collectCalls()).toEqual([]);
      expect(lines.join('\n')).toContain('подсчёт без выполнения (--collect-tests) пропущен');
    });

    it('подсчёт снят по потолку времени — причина названа, план прежний', async () => {
      specs({ 'a.spec.ts': 2 });
      fake.outcomes.set(1, 'timeout');
      await runGroups(options({ collectTests: true }));
      expect(lines.join('\n')).toContain('подсчёт без выполнения не удался: снят по потолку времени');
    });
  });
});
