import { readBoundedInt } from '../read-bounded-int';
import { parseRunnerArgs } from './parse-runner-args';
import { readEnvOptions } from './read-env-options';

describe('parseRunnerArgs', () => {
  const parse = (argv: string[]) => parseRunnerArgs(argv, 'USAGE');

  it('все флаги раннера, значения отдельным аргументом и через =', () => {
    expect(
      parse([
        '--out',
        'r.json',
        '--merge-coverage=cov/c.json',
        '--junit',
        'j.xml',
        '--changed-since',
        'main',
        '--shard=2/4',
        '--dry-run',
        '--collect-tests',
        '--',
        'jest',
        '--config',
        'x',
      ]),
    ).toEqual({
      out: 'r.json',
      mergeCoverageTo: 'cov/c.json',
      junitTo: 'j.xml',
      changedSince: 'main',
      shard: { index: 2, count: 4 },
      dryRun: true,
      failedOnly: false,
      collectTests: true,
      command: ['jest', '--config', 'x'],
    });
  });

  it('возобновление: --from-group N или --failed-only, но не оба', () => {
    expect(parse(['--out', 'r', '--from-group', '3', '--', 'jest']).fromGroup).toBe(3);
    expect(parse(['--out', 'r', '--failed-only', '--', 'jest']).failedOnly).toBe(true);
    expect(() => parse(['--out', 'r', '--from-group', '3', '--failed-only', '--', 'jest'])).toThrow(
      'нужен один',
    );
  });

  it.each([
    [['--out', 'r', '--merge-coverge', 'x', '--', 'jest'], 'неизвестный флаг раннера «--merge-coverge»'],
    [['--out', 'r', '--dry-run=1', '--', 'jest'], 'неизвестный флаг раннера «--dry-run=1»'],
    [['--out', '--', 'jest'], '--out без значения'],
    [['--out', 'r', '--shard', '2', '--', 'jest'], 'нужна форма <номер>/<всего>'],
    [['--out', 'r', '--from-group', 'x', '--', 'jest'], 'нужен номер группы'],
    [['--dry-run', '--', 'jest'], 'не задан --out'],
    [['--out', 'r', 'jest'], 'USAGE'],
    [['--out', 'r', '--'], 'USAGE'],
  ])('%j — отказ', (argv, message) => {
    expect(() => parse(argv)).toThrow(message);
  });
});

describe('readBoundedInt и пределы переменных', () => {
  it('за пределом и не целое — отказ с именем и пределами; пусто — по умолчанию', () => {
    expect(readBoundedInt('', 7, 'X', { min: 1, max: 9 })).toBe(7);
    expect(readBoundedInt('9', 7, 'X', { min: 1, max: 9 })).toBe(9);
    expect(() => readBoundedInt('10', 7, 'X', { min: 1, max: 9 })).toThrow('X — от 1 до 9, получено 10');
    expect(() => readBoundedInt('0', 7, 'X', { min: 1, max: 9 })).toThrow('X — от 1 до 9, получено 0');
    expect(() => readBoundedInt('2.5', 7, 'X', { min: 1, max: 9 })).toThrow('X — целое число');
  });

  // Обещание раннера: поднять потолок тестов или воркеров переменной нельзя.
  it.each([
    ['JEST_GROUP_WORKERS', '3', 'от 1 до 2'],
    ['JEST_GROUP_MAX_TESTS', '301', 'от 1 до 300'],
    ['JEST_GROUP_TIMEOUT_S', String(4 * 3600 + 1), 'от 1 до 14400'],
    ['JEST_GROUP_KILL_GRACE_S', '0', 'от 1 до 120'],
    ['JEST_GROUP_MACHINE_WAIT_S', '3601', 'от 1 до 3600'],
    ['JEST_GROUP_MAX_LOAD_PERCENT', '5', 'от 10 до 1000'],
    ['JEST_GROUP_MAX_RSS_MB', '10', 'от 64 до'],
    ['JEST_GROUP_ARGV_BUDGET', String(256 * 1024 + 1), 'от 1 до 262144'],
    ['JEST_GROUPS_STRICT', '2', 'от 0 до 1'],
    ['JEST_GROUPS_STRICT', 'yes', 'целое число'],
  ])('%s=%s — отказ (%s)', (name, value, message) => {
    expect(() => readEnvOptions({ [name]: value }, 'linux')).toThrow(`${name} — ${message}`);
  });

  it('потолок памяти выше физической — отказ', () => {
    const machine = { bytes: 16 * 1024 ** 3, source: 'machine' } as const;
    expect(() => readEnvOptions({ JEST_GROUP_MAX_RSS_MB: '16385' }, 'linux', machine)).toThrow(
      'не больше физической памяти (16384 МБ)',
    );
  });

  it('в контейнере с пределом cgroup потолок и порог свободной памяти — от предела, а не от хоста', () => {
    const MB = 1024 * 1024;
    // Хост 64 ГБ, контейнер 4 ГБ: от хоста потолок группы был бы 32 ГБ (контейнер убьёт OOM
    // раньше), порог свободной памяти — 6,4 ГБ (в контейнере его не бывает, ожидание до отказа).
    const cgroup = { bytes: 4096 * MB, source: 'cgroup' } as const;
    const options = readEnvOptions({}, 'linux', cgroup);
    expect({ maxRssBytes: options.limits?.maxRssBytes, minFreeBytes: options.machine?.minFreeBytes }).toEqual(
      {
        maxRssBytes: 2048 * MB,
        minFreeBytes: 1024 * MB,
      },
    );
    expect(() => readEnvOptions({ JEST_GROUP_MAX_RSS_MB: '4097' }, 'linux', cgroup)).toThrow(
      'не больше предела памяти контейнера (cgroup) (4096 МБ), получено 4097',
    );
    expect(readEnvOptions({ JEST_GROUP_MAX_RSS_MB: '4096' }, 'linux', cgroup).limits?.maxRssBytes).toBe(
      4096 * MB,
    );
  });

  it.each([
    [1024, 256],
    [512, 128],
    [8192, 1024],
  ])('контейнер %i МБ: порог свободной памяти %i МБ — меньше предела, достижим', (limitMb, freeMb) => {
    const MB = 1024 * 1024;
    const options = readEnvOptions({}, 'linux', { bytes: limitMb * MB, source: 'cgroup' });
    expect(options.machine?.minFreeBytes).toBe(freeMb * MB);
    // Машина без предела — прежнее правило: не меньше 1 ГБ.
    expect(
      readEnvOptions({}, 'linux', { bytes: limitMb * MB, source: 'machine' }).machine?.minFreeBytes,
    ).toBe(Math.max(1024, Math.floor(limitMb * 0.1)) * MB);
  });

  it('значения по умолчанию — обещания раннера и защиты машины', () => {
    const options = readEnvOptions({}, 'linux');
    expect({
      maxTests: options.maxTests,
      workers: options.workers,
      timeoutMs: options.limits?.timeoutMs,
      killGraceMs: options.limits?.killGraceMs,
      maxDurationMs: options.limits?.maxDurationMs,
      maxLoadPercent: options.machine?.maxLoadPercent,
      maxWaitMs: options.machine?.maxWaitMs,
      argvBudgetBytes: options.argvBudgetBytes,
    }).toEqual({
      maxTests: 300,
      workers: 2,
      timeoutMs: 1_800_000,
      killGraceMs: 10_000,
      maxDurationMs: undefined,
      maxLoadPercent: 150,
      maxWaitMs: 600_000,
      argvBudgetBytes: 262_144,
    });
    expect(readEnvOptions({}, 'win32').argvBudgetBytes).toBe(7_000);
    expect(readEnvOptions({ JEST_GROUP_MAX_SECONDS: '90' }, 'linux').limits?.maxDurationMs).toBe(90_000);
  });

  it('потолок факта строгий по умолчанию; 0 — только строка в журнале', () => {
    expect(
      [{}, { JEST_GROUPS_STRICT: '' }, { JEST_GROUPS_STRICT: '1' }, { JEST_GROUPS_STRICT: '0' }].map(
        (env) => readEnvOptions(env, 'linux').strictCeiling,
      ),
    ).toEqual([true, true, true, false]);
  });
});
