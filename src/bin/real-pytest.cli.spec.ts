import { spawn, spawnSync } from 'node:child_process';
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

import { RunnerSandbox } from '../testing/runner-sandbox';

/**
 * Собранный `pytest-groups` против НАСТОЯЩЕГО pytest + pytest-xdist из venv
 * пакета (`.venv`, версии — requirements-pytest.txt). Нет venv — спека
 * красная с инструкцией, а не пропуск: молчаливый пропуск выглядел бы
 * проверкой.
 */
const ROOT = join(__dirname, '..', '..');
const RUNNER = join(ROOT, 'dist', 'bin', 'pytest-groups.js');
const ASSERT = join(ROOT, 'dist', 'bin', 'jest-assert-no-skipped.js');
const PYTEST = join(ROOT, '.venv', 'bin', 'pytest');
if (!existsSync(RUNNER)) {
  throw new Error(`нет ${RUNNER}: сначала pnpm run build`);
}
if (!existsSync(PYTEST)) {
  throw new Error(`нет ${PYTEST}: python3 -m venv .venv && .venv/bin/pip install -r requirements-pytest.txt`);
}

describe('pytest-groups на настоящем pytest', () => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'pytest-groups-real-')));
    mkdirSync(join(work, 'tests'));
    writeFileSync(join(work, 'pytest.ini'), '[pytest]\naddopts = -p no:cacheprovider\n');
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const write = (file: string, text: string): void => writeFileSync(join(work, file), text);
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env,
    JEST_GROUP_MIN_FREE_MB: '0',
    JEST_GROUP_MAX_LOAD_PERCENT: '1000',
    PYTEST_ADDOPTS: '',
    JEST_GROUPS_STRICT: '',
    ...extra,
  });
  const runner = (extra: Record<string, string> = {}, args: string[] = []) =>
    spawnSync(process.execPath, [RUNNER, '--out', join(work, 'r.json'), '--', PYTEST, ...args], {
      cwd: work,
      encoding: 'utf8',
      env: env(extra),
    });
  const report = () =>
    JSON.parse(readFileSync(join(work, 'r.json'), 'utf8')) as {
      numTotalTests: number;
      success: boolean;
      testResults: { name: string; assertionResults: unknown[] }[];
    };
  const groupLines = (stdout: string): string[] =>
    stdout.split('\n').filter((line) => line.startsWith('[группа '));
  /** Тест, пишущий имя воркера xdist и pid в журнал. */
  const recording = (name: string, count: number, sleep = 0): string =>
    `import os, time\n${Array.from(
      { length: count },
      (_, index) =>
        `def test_${name}_${index}():\n    with open(${JSON.stringify(join(work, 'workers.log'))}, 'a') as log:\n        log.write(os.environ.get('PYTEST_XDIST_WORKER', 'нет') + ' ' + str(os.getpid()) + '\\n')\n    time.sleep(${sleep})\n    with open(${JSON.stringify(join(work, 'done.log'))}, 'a') as log:\n        log.write('done\\n')\n`,
    ).join('\n')}`;

  it('группы по ТОЧНОМУ числу тестов из сбора, воркеров xdist не больше двух, отчёт слит', () => {
    write('tests/test_a.py', recording('a', 6, 0.2));
    write('tests/test_b.py', recording('b', 3));
    write('tests/test_c.py', recording('c', 2));
    // Потолок 6 → план 5: a (6) — своей группой сверх плана, b + c (5) — одной.
    const result = runner({ JEST_GROUP_MAX_TESTS: '6' });

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(
      groupLines(result.stdout).map((line) => / файлов \d+, тестов \d+ \(план \d+\)/.exec(line)?.[0]),
    ).toEqual([' файлов 1, тестов 6 (план 6)', ' файлов 2, тестов 5 (план 5)']);
    expect(report().numTotalTests).toBe(11);
    expect(
      report()
        .testResults.map((suite) => suite.name.slice(work.length + 1))
        .sort(),
    ).toEqual(['tests/test_a.py', 'tests/test_b.py', 'tests/test_c.py']);
    const workers = new Set(
      readFileSync(join(work, 'workers.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')[0]),
    );
    expect([...workers].sort()).toEqual(['gw0', 'gw1']);
  }, 120_000);

  it.each([
    [{}, ['-n', '8'], '-n'],
    [{}, ['--numprocesses=8'], '--numprocesses=8'],
    [{ PYTEST_ADDOPTS: '-n 8' }, [], 'в PYTEST_ADDOPTS флаги'],
  ])(
    'флаг воркеров в команде или PYTEST_ADDOPTS — отказ до запуска (%j %j)',
    (extra, args, message) => {
      write('tests/test_a.py', 'def test_a():\n    pass\n');
      const result = runner(extra as Record<string, string>, args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
      expect(existsSync(join(work, 'r.json'))).toBe(false);
    },
    60_000,
  );

  it('упавший тест — код 1; пропущенный виден проверке пропусков', () => {
    write(
      'tests/test_a.py',
      'import pytest\n\ndef test_ok():\n    pass\n\n@pytest.mark.skip(reason="later")\ndef test_later():\n    pass\n',
    );
    expect(runner().status).toBe(0);
    const check = spawnSync(process.execPath, [ASSERT, join(work, 'r.json')], { encoding: 'utf8' });
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('пропущено тестов: 1');
    write('tests/test_a.py', 'def test_bad():\n    assert 0\n');
    expect(runner().status).toBe(1);
    expect(report().success).toBe(false);
  }, 60_000);

  it('тестов нет — отказ «выборка пуста», а не зелёный прогон', () => {
    write('tests/test_a.py', '# тестов нет\n');
    const result = runner();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('пуста');
  }, 60_000);

  it('SIGTERM раннеру снимает pytest за shell-обёрткой без exec и его воркеры xdist', async () => {
    write('tests/test_a.py', recording('a', 2, 30));
    // Сам pytest на SIGTERM гасит свои воркеры; за обёрткой (`./scripts/test.sh`)
    // сигнал до него доходит, только если раннер шлёт его всей группе процессов.
    write('run.sh', `#!/bin/sh\n"${PYTEST}" "$@"\ncode=$?\nexit $code\n`);
    const child = spawn(
      process.execPath,
      [RUNNER, '--out', join(work, 'r.json'), '--', '/bin/sh', join(work, 'run.sh')],
      {
        cwd: work,
        env: env({ JEST_GROUP_KILL_GRACE_S: '2' }),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    const pids = (): number[] =>
      existsSync(join(work, 'workers.log'))
        ? readFileSync(join(work, 'workers.log'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => Number(line.split(' ')[1]))
        : [];
    try {
      for (let attempt = 0; attempt < 400 && pids().length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(pids()).toHaveLength(2);
      child.kill('SIGTERM');
      expect(await exited).toBe(143);
      for (const pid of pids()) {
        expect({ pid, gone: await RunnerSandbox.gone(pid) }).toEqual({ pid, gone: true });
      }
      // Тесты (по 30 с) сняты, а не доиграли: снятый pytest не пишет «done».
      expect(existsSync(join(work, 'done.log'))).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      for (const pid of pids()) {
        RunnerSandbox.killQuietly(pid);
      }
    }
  }, 120_000);
});
