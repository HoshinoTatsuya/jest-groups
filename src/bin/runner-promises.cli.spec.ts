import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { RunnerSandbox } from '../testing/runner-sandbox';

/**
 * Обещания раннера, которые держат машину: «≤2 воркера», «≤300 тестов в
 * группе», «после остановки не остаётся ни одного процесса». Каждое — против
 * собранного CLI и поддельного jest, в том числе за shell-обёрткой без exec
 * (`-- ./scripts/jest.sh`, `sh -c '…; …'`, менеджеры пакетов).
 */
const RUNNER = join(__dirname, '..', '..', 'dist', 'bin', 'jest-groups.js');
if (!existsSync(RUNNER)) {
  throw new Error(`нет ${RUNNER}: сначала pnpm run build`);
}

describe('флаги раннера в любом написании — отказ до запуска', () => {
  let box: RunnerSandbox;
  beforeEach(() => {
    box = new RunnerSandbox(RUNNER);
    box.setCounts({ 'a.spec.ts': 2 });
  });
  afterEach(() => box.dispose());

  // yargs, разбирающий argv jest, разворачивает kebab-case в camelCase, а
  // группу коротких флагов — по букве: `-w4` — это maxWorkers=4, `-bi` —
  // bail + runInBand. Прежняя регулярка знала только camelCase и голые `-w`/`-i`.
  it.each([
    ['--max-workers=16', '--max-workers'],
    ['--max-workers', '--max-workers'],
    ['--run-in-band', '--run-in-band'],
    ['--watch-all', '--watch-all'],
    ['--output-file=r.json', '--output-file'],
    ['-w4', '-w4'],
    ['-w=4', '-w=4'],
    ['-bi', '-bi'],
  ])('%s — отказ, ни одного запуска jest', (flag, named) => {
    const result = box.invoke({ jestArgs: [flag] });
    expect({ status: result.status, calls: box.events() }).toEqual({ status: 2, calls: [] });
    expect(result.stderr).toContain(named);
  });

  it('контроль: флаги с похожими буквами, которые раннер не задаёт, проходят', () => {
    // `-b` (bail) и `--watchman` — не флаги раннера: отказ на них был бы ложным.
    const result = box.invoke({ jestArgs: ['-b', '--watchman=false'] });
    expect(result.status).toBe(0);
    expect(box.groups()).toEqual([['a.spec.ts']]);
  });
});

describe('кэш числа тестов: свежесть по файлу, отдельно на команду', () => {
  let box: RunnerSandbox;
  beforeEach(() => {
    box = new RunnerSandbox(RUNNER);
  });
  afterEach(() => box.dispose());

  /**
   * Прежде свежесть мерилась mtime ОБЩЕГО файла кэша. Узкий прогон (`test:db`,
   * оборванный прогон) переписывал кэш позже правки спеки — и выросший файл
   * планировался по старому числу: группа выходила за потолок.
   */
  it('спека выросла, потом прошёл узкий прогон без неё — следующий полный план видит рост', () => {
    box.setCounts({ 'a.spec.ts': 10, 'b.spec.ts': 10 });
    expect(box.invoke().status).toBe(0);
    // a.spec.ts вырос до 290 тестов (текст и факт).
    box.writeSpec('a.spec.ts', 290);
    box.setCounts({ 'a.spec.ts': 290, 'b.spec.ts': 10 });
    // Узкий прогон: только b — он переписывает кэш, a не выполняется.
    expect(box.invoke({ env: { FAKE_ONLY: box.abs('b.spec.ts') } }).status).toBe(0);
    const full = box.invoke();

    expect(full.status).toBe(0);
    // По старому числу a (10) + b (10) шли бы одной группой — 300 тестов при плане 285.
    expect(box.groups()).toEqual([['a.spec.ts'], ['b.spec.ts']]);
  });

  it('у каждой команды выборки свой кэш: факты одной не планируют другую', () => {
    // Тексты на 200 тестов: без истории оценка 250 разносит файлы по группам.
    box.writeSpec('a.spec.ts', 200);
    box.writeSpec('b.spec.ts', 200);
    box.setCounts({ 'a.spec.ts': 10, 'b.spec.ts': 10 });
    // Команда A (`jest`) знает по 10 тестов на файл.
    expect(box.invoke().status).toBe(0);
    // Команда B (`jest --config=db`) на тех же файлах отчитывает в 20 раз больше.
    const other = box.invoke({ jestArgs: ['--config=db'] });

    expect(other.status).toBe(0);
    // Общий кэш дал бы B факты A (10 + 10) и одну группу на 400 тестов.
    expect(box.groups()).toEqual([['a.spec.ts'], ['b.spec.ts']]);
    expect(other.stdout).not.toContain('больше 300 тестов вышло');
  });
});

describe('сигнал раннеру снимает ВСЮ группу процессов jest', () => {
  let box: RunnerSandbox;
  beforeEach(() => {
    box = new RunnerSandbox(RUNNER);
  });
  afterEach(() => box.dispose());

  const pidOf = (event: string): number => {
    const entry = box.events().find((item) => item.event === event);
    if (entry?.pid === undefined) {
      throw new Error(`нет pid для «${event}»: ${JSON.stringify(box.events())}`);
    }
    return entry.pid;
  };

  it('jest за shell-обёрткой без exec получает SIGTERM; после выхода раннера его нет', async () => {
    box.setCounts({ 'a.spec.ts': 2 });
    const run = box.start({ wrapped: true, env: { FAKE_HANG: box.abs('a.spec.ts') } });
    await box.waitFor('hanging');
    const jest = pidOf('hanging');
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    // Прежде сигнал получала только обёртка: jest доигрывал сиротой.
    expect(box.events().map((entry) => entry.event)).toEqual(['start', 'hanging', 'term']);
    expect(await RunnerSandbox.gone(jest)).toBe(true);
  }, 30_000);

  it('jest, глухой к SIGTERM, снимается SIGKILL после потолка ожидания', async () => {
    box.setCounts({ 'a.spec.ts': 2 });
    const run = box.start({
      wrapped: true,
      env: { FAKE_HANG: box.abs('a.spec.ts'), FAKE_IGNORE_TERM: '1', JEST_GROUP_KILL_GRACE_S: '1' },
    });
    await box.waitFor('hanging');
    const jest = pidOf('hanging');
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    expect(await RunnerSandbox.gone(jest)).toBe(true);
    // Не дожил до своего таймера: снят, а не вышел сам.
    expect(box.events().map((entry) => entry.event)).not.toContain('self-exit');
  }, 30_000);

  it('выборка --listTests за обёрткой: раннер не ждёт pipe, который держит сирота', async () => {
    box.setCounts({ 'a.spec.ts': 2 });
    const run = box.start({
      wrapped: true,
      env: { FAKE_LIST_HANG: '1', FAKE_IGNORE_TERM: '1', JEST_GROUP_KILL_GRACE_S: '1' },
    });
    await box.waitFor('hanging');
    const jest = pidOf('hanging');
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    expect(run.stderr()).toContain('во время выборки');
    expect(await RunnerSandbox.gone(jest)).toBe(true);
    // Прежде раннер ждал 'close' pipe, пока сирота не вышла по своему таймеру.
    expect(box.events().map((entry) => entry.event)).not.toContain('self-exit');
  }, 40_000);

  it('выборка: процесс, сбежавший из группы и держащий pipe, раннер не ждёт', async () => {
    box.setCounts({ 'a.spec.ts': 2 });
    const run = box.start({
      env: { FAKE_LIST_HANG: '1', FAKE_LIST_ESCAPE: '1', JEST_GROUP_KILL_GRACE_S: '1' },
    });
    await box.waitFor('hanging');
    const escaped = box.events().find((entry) => entry.event === 'escaped')?.pid ?? 0;
    run.child.kill('SIGTERM');

    expect(await run.exited).toBe(143);
    // Сбежавший ещё жив (снять его раннер не может — он вне группы), а раннер уже вышел.
    expect(RunnerSandbox.alive(escaped)).toBe(true);
  }, 40_000);
});

describe('потолки группы и защита машины — на настоящих процессах', () => {
  let box: RunnerSandbox;
  beforeEach(() => {
    box = new RunnerSandbox(RUNNER);
    box.setCounts({ 'a.spec.ts': 2 });
  });
  afterEach(() => box.dispose());

  it('зависшая группа снимается по потолку времени: код 2, jest за обёрткой снят', async () => {
    const run = box.start({
      wrapped: true,
      env: { FAKE_HANG: box.abs('a.spec.ts'), JEST_GROUP_TIMEOUT_S: '1', JEST_GROUP_KILL_GRACE_S: '1' },
    });
    await box.waitFor('hanging');
    const jest = box.events().find((entry) => entry.event === 'hanging')?.pid ?? 0;

    expect(await run.exited).toBe(2);
    expect(run.stderr()).toContain('группа 1: снята по потолку времени 1 с (JEST_GROUP_TIMEOUT_S)');
    expect(box.events().map((entry) => entry.event)).toEqual(['start', 'hanging', 'term']);
    expect(await RunnerSandbox.gone(jest)).toBe(true);
  }, 30_000);

  it('группа сверх потолка памяти снимается: код 2, причина названа', async () => {
    const run = box.start({ env: { FAKE_ALLOC_MB: '400', JEST_GROUP_MAX_RSS_MB: '200' } });
    await box.waitFor('allocated');
    const jest = box.events().find((entry) => entry.event === 'allocated')?.pid ?? 0;

    expect(await run.exited).toBe(2);
    expect(run.stderr()).toContain('группа 1: снята по потолку памяти 200 МБ (JEST_GROUP_MAX_RSS_MB)');
    expect(await RunnerSandbox.gone(jest)).toBe(true);
    expect(box.events().map((entry) => entry.event)).not.toContain('self-exit');
  }, 30_000);

  it('потолок памяти видит и нетронутые страницы (macOS их сжимает, RSS падает)', async () => {
    // Замер 28.11.2026 на macOS под нехваткой памяти: 400 МБ, которые больше не трогают, через
    // полсекунды — 36 МБ RSS, и потолок по RSS такую группу пропускал. Сквозная проверка того, что
    // раннер снимает её по footprint; отличить меры она может только под нехваткой памяти (первый
    // опрос через секунду бывает раньше сжатия), всегда их отличает спека readGroupRss.
    const run = box.start({
      env: { FAKE_ALLOC_MB: '400', FAKE_ALLOC_COLD: '1', JEST_GROUP_MAX_RSS_MB: '200' },
    });
    await box.waitFor('allocated');
    const jest = box.events().find((entry) => entry.event === 'allocated')?.pid ?? 0;

    expect(await run.exited).toBe(2);
    expect(run.stderr()).toContain('группа 1: снята по потолку памяти 200 МБ (JEST_GROUP_MAX_RSS_MB)');
    expect(await RunnerSandbox.gone(jest)).toBe(true);
    expect(box.events().map((entry) => entry.event)).not.toContain('self-exit');
  }, 30_000);

  it('процесс, оставленный тестом, снимается после группы и назван в журнале', async () => {
    const result = box.invoke({ env: { FAKE_LEAK: '1' } });
    const leaked = box.events().find((entry) => entry.event === 'leak')?.pid ?? 0;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('после группы 1 в её группе процессов остались процессы — сняты');
    expect(leaked).toBeGreaterThan(0);
    expect(await RunnerSandbox.gone(leaked)).toBe(true);
  }, 30_000);

  it('машина не в норме дольше потолка ожидания — ни одной группы, отказ с причиной', () => {
    // 1 ТБ свободной памяти не бывает: норма не наступит.
    const result = box.invoke({
      env: { JEST_GROUP_MIN_FREE_MB: String(1024 * 1024), JEST_GROUP_MACHINE_WAIT_S: '1' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('машина не пришла в норму за 1 с (свободной памяти');
    expect(box.groups()).toEqual([]);
  }, 30_000);

  it('SIGHUP (закрыт терминал) — та же остановка, код 129', async () => {
    const run = box.start({ wrapped: true, env: { FAKE_HANG: box.abs('a.spec.ts') } });
    await box.waitFor('hanging');
    const jest = box.events().find((entry) => entry.event === 'hanging')?.pid ?? 0;
    run.child.kill('SIGHUP');
    expect(await run.exited).toBe(129);
    expect(await RunnerSandbox.gone(jest)).toBe(true);
  }, 30_000);

  it('второй сигнал — SIGKILL группе сразу, не дожидаясь потолка ожидания', async () => {
    const run = box.start({
      wrapped: true,
      env: { FAKE_HANG: box.abs('a.spec.ts'), FAKE_IGNORE_TERM: '1', JEST_GROUP_KILL_GRACE_S: '60' },
    });
    await box.waitFor('hanging');
    const jest = box.events().find((entry) => entry.event === 'hanging')?.pid ?? 0;
    run.child.kill('SIGTERM');
    await box.waitFor('term');
    run.child.kill('SIGTERM');
    expect(await run.exited).toBe(143);
    expect(await RunnerSandbox.gone(jest)).toBe(true);
    expect(box.events().map((entry) => entry.event)).not.toContain('self-exit');
  }, 30_000);

  it.each([
    [['--merge-coverge', 'x'], 'неизвестный флаг раннера «--merge-coverge»'],
    [['--shard', '3/2'], '--shard 3/2'],
  ])('флаги раннера %j — отказ до запуска', (flags, message) => {
    const result = box.invoke({ flags });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(box.events()).toEqual([]);
  });

  it.each([
    ['JEST_GROUP_WORKERS', '4'],
    ['JEST_GROUP_MAX_TESTS', '1000'],
  ])('%s=%s выше обещания раннера — отказ, ни одного запуска', (name, value) => {
    const result = box.invoke({ env: { [name]: value } });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${name} — от 1 до`);
    expect(box.events()).toEqual([]);
  });
});
