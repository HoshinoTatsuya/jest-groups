import { spawn, type spawnSync } from 'node:child_process';

import { RunnerSandbox } from '../testing/runner-sandbox';
import type { RunTool } from '../types/run-tool.type';
import { buildSpawnCommand } from './build-spawn-command';
import { isProcessGroupAlive } from './is-process-group-alive';
import { needsShell } from './needs-shell';
import { quoteCmdArgument } from './quote-cmd-argument';
import { readGroupRss } from './read-group-rss';
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

describe('readGroupRss', () => {
  const PS = ['  700   700  10240', '  700   701   2048', '  800   801 999999', ''].join('\n');
  const tool = (footprint: { status: number | null; stdout: string }): RunTool & { calls: string[][] } => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return command === 'ps' ? { status: 0, stdout: PS } : footprint;
    };
    return Object.assign(run, { calls });
  };

  it('macOS — footprint процессов группы, а не RSS; чужая группа не считается', () => {
    const run = tool({
      status: 0,
      stdout: [
        'node [700]: 64-bit    Footprint: 431589416 B (16384 bytes per page)',
        'node [701]: 64-bit    Footprint: 116770616 B (16384 bytes per page)',
      ].join('\n'),
    });
    expect(readGroupRss(700, 'darwin', run)).toBe(431_589_416 + 116_770_616);
    expect(run.calls[1]).toEqual(['footprint', '--noCategories', '-f', 'bytes', '-p', '700', '-p', '701']);
  });

  it('macOS — по процессу большее из footprint и RSS; процесса нет в ответе — его RSS', () => {
    // 700: footprint меньше RSS (общие страницы) — RSS; 701 завершился до footprint — RSS.
    const run = tool({ status: 0, stdout: 'node [700]: 64-bit    Footprint: 4096 B (16384 bytes per page)' });
    expect(readGroupRss(700, 'darwin', run)).toBe(10_240 * 1024 + 2048 * 1024);
  });

  it('macOS — footprint не ответил или нет его — RSS, а не «измерить нечем»', () => {
    expect(readGroupRss(700, 'darwin', tool({ status: null, stdout: '' }))).toBe(12_288 * 1024);
  });

  it('macOS — pid в имени процесса не подменяет чужой: берётся последняя [pid]: и только из группы', () => {
    const run = tool({
      status: 0,
      stdout: 'evil [701]: 64-bit    Footprint: 9 B [801]: 64-bit    Footprint: 999999999999 B',
    });
    expect(readGroupRss(700, 'darwin', run)).toBe(12_288 * 1024);
  });

  it('FreeBSD/OpenBSD — RSS из ps, footprint не зовётся; ps упал — null', () => {
    const run = tool({ status: 0, stdout: '' });
    expect(readGroupRss(700, 'freebsd', run)).toBe(12_288 * 1024);
    expect(run.calls.map((call) => call[0])).toEqual(['ps']);
    expect(readGroupRss(700, 'openbsd', () => ({ status: 1, stdout: '' }))).toBeNull();
    expect(readGroupRss(700, 'win32', run)).toBeNull();
  });

  const posix = process.platform === 'win32' ? it.skip : it;
  posix(
    'настоящая группа: 400 МБ, которые больше не трогают, видны целиком [пропущено на Windows: нет групп процессов]',
    async () => {
      // Замер 28.11.2026 на macOS под нехваткой памяти: через полсекунды такой процесс показывал
      // 36 МБ RSS при footprint 412 МБ — система сжимает нетронутые страницы. Мутация «мера — RSS»
      // здесь даёт 41 МБ. На свободной машине сжатия нет, и RSS-мера этот тест тоже проходит:
      // всегда отличает меры только спека с подменённым footprint выше.
      const child = spawn(
        process.execPath,
        [
          '-e',
          "const b = Buffer.alloc(400 * 2 ** 20, 1); console.log('ready'); setTimeout(() => b[0]++, 20000)",
        ],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const pid = child.pid ?? 0;
      try {
        await new Promise<void>((resolve) => child.stdout?.once('data', () => resolve()));
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(readGroupRss(pid)).toBeGreaterThan(380 * 2 ** 20);
      } finally {
        process.kill(-pid, 'SIGKILL');
      }
    },
    20_000,
  );
});
