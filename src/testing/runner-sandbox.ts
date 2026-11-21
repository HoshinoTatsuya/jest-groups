import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertSignalablePid } from '../process/assert-signalable-pid';
import { isSignalablePid } from '../process/is-signalable-pid';
import { FAKE_JEST } from './fake-jest.source';

/**
 * Каталог проекта для сквозных спек раннера: собранный CLI против поддельного
 * jest. Состояние (кэш, файлы спек, числа тестов) живёт между вызовами — так
 * проверяется то, что делает ПОСЛЕДОВАТЕЛЬНОСТЬ прогонов (узкий прогон между
 * двумя полными, вторая команда выборки).
 *
 * Поддельный jest вызывается напрямую (`node fake-jest.cjs`) или через
 * shell-обёртку БЕЗ exec (`sh jest.sh`): обёртка остаётся родителем jest, и
 * сигнал, посланный только ей, до jest не доходит.
 */
export class RunnerSandbox {
  public readonly work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-sandbox-')));
  private readonly started: ChildProcess[] = [];

  public constructor(private readonly runner: string) {
    writeFileSync(join(this.work, 'fake-jest.cjs'), FAKE_JEST);
    // Две команды подряд: оболочка не заменяет себя последней (exec-оптимизация
    // `sh -c 'одна команда'`) и остаётся промежуточным процессом.
    writeFileSync(
      join(this.work, 'jest.sh'),
      `#!/bin/sh\n"${process.execPath}" "$(dirname "$0")/fake-jest.cjs" "$@"\ncode=$?\nexit $code\n`,
    );
    chmodSync(join(this.work, 'jest.sh'), 0o755);
    writeFileSync(join(this.work, 'calls.log'), '');
    this.setCounts({});
  }

  /** Числа тестов, которые отчитает поддельный jest; файлы создаются, если их нет. */
  public setCounts(counts: Record<string, number>): void {
    for (const file of Object.keys(counts)) {
      if (!existsSync(join(this.work, file))) {
        writeFileSync(join(this.work, file), '');
      }
    }
    writeFileSync(
      join(this.work, 'counts.json'),
      JSON.stringify(Object.fromEntries(Object.entries(counts).map(([file, n]) => [this.abs(file), n]))),
    );
  }

  /** Текст файла спеки: по нему раннер оценивает число тестов файла без истории. */
  public writeSpec(file: string, tests: number): void {
    writeFileSync(
      join(this.work, file),
      `${Array.from({ length: tests }, (_, i) => `it('t${i}', () => undefined);`).join('\n')}\n`,
    );
  }

  public abs(file: string): string {
    return join(this.work, file);
  }

  /** Команда выборки: поддельный jest напрямую или за shell-обёрткой без exec. */
  public command(wrapped = false): string[] {
    return wrapped ? ['/bin/sh', this.abs('jest.sh')] : [process.execPath, 'fake-jest.cjs'];
  }

  public env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      FAKE_COUNTS: this.abs('counts.json'),
      FAKE_LOG: this.abs('calls.log'),
      JEST_GROUP_MAX_TESTS: '',
      JEST_GROUP_WORKERS: '',
      JEST_GROUPS_KEEP_GOING: '',
      JEST_GROUPS_STRICT: '',
      JEST_GROUP_ARGV_BUDGET: '',
      FAKE_TWICE: '',
      FAKE_HANG: '',
      FAKE_REPORT: '',
      FAKE_ONLY: '',
      FAKE_LIST_HANG: '',
      FAKE_IGNORE_TERM: '',
      FAKE_ALLOC_MB: '',
      FAKE_LEAK: '',
      FAKE_LIST_ESCAPE: '',
      // Спеки не зависят от занятости машины: норма проверяется отдельной спекой.
      JEST_GROUP_MIN_FREE_MB: '0',
      JEST_GROUP_MAX_LOAD_PERCENT: '1000',
      ...extra,
    };
  }

  /** Синхронный прогон раннера: `[флаги раннера] -- <команда> [аргументы jest]`. */
  public invoke(
    options: { flags?: string[]; jestArgs?: string[]; env?: Record<string, string>; wrapped?: boolean } = {},
  ): { status: number | null; stdout: string; stderr: string } {
    writeFileSync(this.abs('calls.log'), '');
    const result = spawnSync(
      process.execPath,
      [
        this.runner,
        '--out',
        this.abs('merged.json'),
        ...(options.flags ?? []),
        '--',
        ...this.command(options.wrapped),
        ...(options.jestArgs ?? []),
      ],
      { cwd: this.work, encoding: 'utf8', env: this.env(options.env) },
    );
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  /** Асинхронный запуск — для сигналов: процесс снимается в `dispose`, если спека упала раньше. */
  public start(options: { flags?: string[]; env?: Record<string, string>; wrapped?: boolean } = {}): {
    child: ChildProcess;
    exited: Promise<number | null>;
    stderr: () => string;
  } {
    writeFileSync(this.abs('calls.log'), '');
    const child = spawn(
      process.execPath,
      [
        this.runner,
        '--out',
        this.abs('merged.json'),
        ...(options.flags ?? []),
        '--',
        ...this.command(options.wrapped),
      ],
      { cwd: this.work, env: this.env(options.env), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.started.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.resume();
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    return { child, exited, stderr: () => stderr };
  }

  /** Журнал вызовов поддельного jest. */
  public events(): { event: string; files?: string[]; workers?: string; pid?: number; argv?: number }[] {
    return readFileSync(this.abs('calls.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; pid?: number });
  }

  /** Группы, запущенные последним прогоном, — пути относительно проекта. */
  public groups(): string[][] {
    return this.events()
      .filter((entry) => entry.event === 'start')
      .map((entry) => (entry.files ?? []).map((file) => file.slice(this.work.length + 1)));
  }

  /** Ждать события в журнале поддельного jest (по числу попыток, а не по часам). */
  public async waitFor(event: string, attempts = 200): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.events().some((entry) => entry.event === event)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`поддельный jest не дошёл до «${event}»: ${JSON.stringify(this.events())}`);
  }

  /**
   * Жив ли процесс: `kill(pid, 0)` не шлёт сигнала, только проверяет. pid 0/±1 —
   * отказ, а не «нет»: `gone(pid ?? 0)` иначе было бы зелёным без процесса.
   */
  public static alive(pid: number): boolean {
    assertSignalablePid(pid);
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Ждать завершения процесса (снятый процесс ещё миг висит зомби до подбора init). */
  public static async gone(pid: number, attempts = 40): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!RunnerSandbox.alive(pid)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  /**
   * Добить процесс из журнала при уборке. pid не адресует один процесс (нет,
   * 0, ±1) — сигнал не посылается вовсе: уборка не должна стать `kill(-1)`.
   */
  public static killQuietly(pid: number | undefined): void {
    if (pid === undefined || !isSignalablePid(pid)) {
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // уже завершился
    }
  }

  public cacheFiles(): string[] {
    const dir = join(this.work, 'node_modules', '.cache', 'jest-test-groups');
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  /** Убрать всё: запущенный раннер и каждый процесс, отметившийся в журнале. */
  public dispose(): void {
    for (const child of this.started) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
    for (const { pid } of existsSync(this.abs('calls.log')) ? this.events() : []) {
      RunnerSandbox.killQuietly(pid);
    }
    rmSync(this.work, { recursive: true, force: true });
  }
}
