import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож групп процессов раннера: отдельный процесс в своей сессии (`watchdog-main`), который
 * снимает запущенные группы, если раннер исчез, не сняв их, — убит SIGKILL (его не перехватить,
 * и обработчик выхода раннера не срабатывает). Прежде это было записанным ограничением: группа
 * jest раннера, убитого SIGKILL, доигрывала с воркерами.
 *
 * Связь — pipe в stdin сторожа: строка на каждую запущенную и снятую группу, конец pipe —
 * «раннера нет». Ни сторож, ни pipe не держат раннер живым (`unref`). Сторож запускается
 * лениво, по первой группе, один на процесс раннера. Нет собранного `watchdog-main.js` рядом
 * (исходники под ts-jest) или Windows (групп POSIX нет, дерево снимается `taskkill`) — сторожа
 * нет, остальное работает как прежде.
 */
export class ProcessWatchdog {
  private child: ChildProcess | null | undefined;

  public constructor(
    private readonly main: string = join(__dirname, 'watchdog-main.js'),
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** Группа `pgid` запущена; снимать её — SIGTERM, через `graceMs` — SIGKILL. */
  public watch(pgid: number, graceMs: number): void {
    this.send(`+ ${pgid} ${graceMs}\n`);
  }

  /** Группа `pgid` снята раннером — сторожу её больше не трогать. */
  public unwatch(pgid: number): void {
    if (this.child) {
      this.send(`- ${pgid}\n`);
    }
  }

  private send(line: string): void {
    const child = this.start();
    if (child?.stdin && !child.stdin.destroyed) {
      child.stdin.write(line);
    }
  }

  private start(): ChildProcess | null {
    if (this.child !== undefined) {
      return this.child;
    }
    if (this.platform === 'win32' || !existsSync(this.main)) {
      this.child = null;
      return null;
    }
    const child = spawn(process.execPath, [this.main], {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
    });
    child.on('error', () => {
      this.child = null;
    });
    child.stdin?.on('error', () => undefined);
    child.unref();
    (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
    this.child = child;
    return child;
  }
}
