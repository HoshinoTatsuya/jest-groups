import type { spawnSync } from 'node:child_process';

import { RunnerSandbox } from '../testing/runner-sandbox';
import { buildSpawnCommand } from './build-spawn-command';
import { isProcessGroupAlive } from './is-process-group-alive';
import { needsShell } from './needs-shell';
import { quoteCmdArgument } from './quote-cmd-argument';
import { signalProcessGroup } from './signal-process-group';

/**
 * Windows проверяется по выходным строкам: настоящего cmd.exe на машине
 * разработки нет. Ожидаемые строки — правила разбора cmd.exe и argv программ
 * MSVC (те же, что у широко используемого порта spawn для Windows).
 */
describe('quoteCmdArgument', () => {
  it.each([
    ['plain', '^"plain^"'],
    ['C:\\Users\\Имя Фамилия\\a.spec.ts', '^"C:\\Users\\Имя^ Фамилия\\a.spec.ts^"'],
    // %VAR% и !VAR! раскрывались бы cmd.exe и в кавычках.
    ['%PATH%', '^"^%PATH^%^"'],
    ['!x!', '^"^!x^!^"'],
    ['a&b|c', '^"a^&b^|c^"'],
    // Кавычка внутри: обратные слэши перед ней удваиваются, сама — \".
    ['say "hi"', '^"say^ \\^"hi\\^"^"'],
    // Хвостовые обратные слэши удваиваются: иначе экранировали бы закрывающую кавычку.
    ['dir\\', '^"dir\\\\^"'],
  ])('%s → %s', (arg, quoted) => {
    expect(quoteCmdArgument(arg, false)).toBe(quoted);
  });

  it('для .cmd-обёртки (вторым разбором через %*) — двойное экранирование', () => {
    expect(quoteCmdArgument('%X%', true)).toBe('^^^"^^^%X^^^%^^^"');
  });
});

describe('buildSpawnCommand', () => {
  it('вне Windows и для .exe — как есть', () => {
    expect(buildSpawnCommand('jest', ['--a'], 'linux')).toEqual({
      command: 'jest',
      args: ['--a'],
      verbatim: false,
    });
    expect(buildSpawnCommand('node.exe', ['x'], 'win32')).toEqual({
      command: 'node.exe',
      args: ['x'],
      verbatim: false,
    });
  });

  it('.cmd из node_modules/.bin — cmd.exe /d /s /c "<строка>" с двойным экранированием', () => {
    expect(buildSpawnCommand('node_modules\\.bin\\jest.cmd', ['%A%'], 'win32', 'C:\\cmd.exe')).toEqual({
      command: 'C:\\cmd.exe',
      args: ['/d', '/s', '/c', '"node_modules\\.bin\\jest.cmd ^^^"^^^%A^^^%^^^""'],
      verbatim: true,
    });
  });

  it('прочий .bat — одинарное экранирование', () => {
    expect(buildSpawnCommand('run.bat', ['%A%'], 'win32', 'cmd.exe').args[3]).toBe('"run.bat ^"^%A^%^""');
  });

  it('needsShell — только .cmd/.bat на win32', () => {
    expect([
      needsShell('a.CMD', 'win32'),
      needsShell('a.bat', 'win32'),
      needsShell('a.cmd', 'linux'),
    ]).toEqual([true, true, false]);
  });
});

describe('signalProcessGroup', () => {
  it('Windows — дерево процессов через taskkill /T /F', () => {
    const calls: unknown[][] = [];
    const fake = ((...args: unknown[]) => {
      calls.push(args.slice(0, 2));
      return { status: 0 };
    }) as unknown as typeof spawnSync;
    signalProcessGroup(4242, 'SIGTERM', 'win32', fake);
    expect(calls).toEqual([['taskkill', ['/PID', '4242', '/T', '/F']]]);
  });

  it('POSIX — группе (отрицательный pid); группы нет — не ошибка', () => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('нет'), { code: 'ESRCH' });
    });
    expect(() => signalProcessGroup(4242, 'SIGTERM', 'linux')).not.toThrow();
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
  });

  it('POSIX — отказ, кроме «процесса нет», пробрасывается', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('нельзя'), { code: 'EPERM' });
    });
    expect(() => signalProcessGroup(4242, 'SIGTERM', 'darwin')).toThrow('нельзя');
  });

  // 16.11.2026 сентинел `pid ?? -1` под мутантом стал `kill(-1, 'SIGTERM')`:
  // сигнал всем процессам пользователя. `process.kill` и `taskkill` здесь
  // подменены, настоящего сигнала нет ни при одном исходе.
  it.each([
    ['1 (группа -1 = все процессы)', 1],
    ['-1', -1],
    ['0 (своя группа)', 0],
    ['не число', Number.NaN],
    ['дробное', 4242.5],
  ])('pid %s — отказ без сигнала ни на POSIX, ни на Windows', (_name, pid) => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const calls: unknown[][] = [];
    const fake = ((...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    }) as unknown as typeof spawnSync;
    expect(() => signalProcessGroup(pid, 'SIGTERM', 'linux')).toThrow(RangeError);
    expect(() => signalProcessGroup(pid, 'SIGTERM', 'win32', fake)).toThrow(RangeError);
    expect(() => isProcessGroupAlive(pid)).toThrow(RangeError);
    expect(() => RunnerSandbox.alive(pid)).toThrow(RangeError);
    RunnerSandbox.killQuietly(pid);
    expect({ kill: kill.mock.calls, taskkill: calls }).toEqual({ kill: [], taskkill: [] });
  });

  it('настоящий pid проходит защиту: группе — с минусом, уборке — как есть', () => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    signalProcessGroup(2, 'SIGTERM', 'linux');
    expect(isProcessGroupAlive(4242)).toBe(true);
    RunnerSandbox.killQuietly(4243);
    expect(kill.mock.calls).toEqual([
      [-2, 'SIGTERM'],
      [-4242, 0],
      [4243, 'SIGKILL'],
    ]);
  });
});
