import { spawn } from 'node:child_process';

import { GROUP_DEFAULTS } from '../constants/group-defaults.constant';
import { PROCESS_OUTCOME } from '../constants/process-outcome.constant';
import type { ProcessOutcome } from '../types/process-outcome.type';
import type { ProcessRunner } from '../types/process-runner.type';
import { buildSpawnCommand } from './build-spawn-command';
import { isProcessGroupAlive } from './is-process-group-alive';
import { LIVE_PROCESS_GROUPS } from './live-process-groups';
import { readGroupRss } from './read-group-rss';
import { signalProcessGroup } from './signal-process-group';

/**
 * Настоящий запуск процесса: своя группа процессов (`detached`), и всё, что
 * раннер делает с запуском, делается со ВСЕЙ группой — обёрткой, jest,
 * воркерами.
 *
 * - Отмена, потолок времени, потолок памяти: SIGTERM группе, через
 *   `killGraceMs` — SIGKILL. Прежде сигнал получал только прямой потомок, и
 *   jest за shell-обёрткой без exec доигрывал сиротой.
 * - Выход прямого потомка — не конец: если в группе остались процессы (обёртка
 *   вышла, jest нет; тест оставил сервер), они снимаются тем же порядком, а
 *   результат помечается `leftovers`.
 * - Выборка (`capture`): после выхода группы pipe ждётся не дольше
 *   PIPE_DRAIN_MS. Прежде раннер ждал 'close' pipe, а его держал процесс,
 *   сбежавший из группы, — бесконечно, если тот завис.
 * - stdin — /dev/null: процесс отдельной группы, читающий терминал, был бы
 *   остановлен SIGTTIN и висел.
 *
 * На Windows групп POSIX нет: процесс в той же консоли, снятие — деревом
 * (`taskkill /T /F`), остатки после выхода не ищутся, память не меряется.
 */
export const spawnProcess: ProcessRunner = (executable, args, mode, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const windows = process.platform === 'win32';
    const plan = buildSpawnCommand(executable, args);
    const child = spawn(plan.command, [...plan.args], {
      stdio: ['ignore', mode === 'capture' ? 'pipe' : 'inherit', 'inherit'],
      detached: !windows,
      windowsVerbatimArguments: plan.verbatim,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    });
    const pid = child.pid;
    const graceMs = options.killGraceMs ?? GROUP_DEFAULTS.KILL_GRACE_S * 1000;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, action: () => void): void => {
      const timer = setTimeout(action, ms);
      timer.unref();
      timers.push(timer);
    };
    let outcome: ProcessOutcome = PROCESS_OUTCOME.exited;
    let stopping = false;
    let peak: number | null = null;
    const chunks: Buffer[] = [];
    let piped = mode !== 'capture';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    const pipeClosed = new Promise<void>((resolve) => {
      if (child.stdout === null) {
        resolve();
      } else {
        child.stdout.once('close', () => {
          piped = true;
          resolve();
        });
      }
    });

    const signalGroup = (signal: NodeJS.Signals): void => {
      if (pid !== undefined) {
        signalProcessGroup(pid, signal);
      }
    };
    const stop = (why: ProcessOutcome, signal: NodeJS.Signals): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      outcome = why;
      signalGroup(signal);
      later(graceMs, () => signalGroup('SIGKILL'));
    };
    const onAbort = (): void => {
      const reason = options.signal?.reason;
      stop(PROCESS_OUTCOME.aborted, typeof reason === 'string' ? (reason as NodeJS.Signals) : 'SIGTERM');
    };

    if (pid !== undefined) {
      LIVE_PROCESS_GROUPS.add(pid);
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
    }
    if (options.timeoutMs !== undefined) {
      later(options.timeoutMs, () => stop(PROCESS_OUTCOME.timeout, 'SIGTERM'));
    }
    if (options.stallAfterMs !== undefined && options.onStall !== undefined) {
      const onStall = options.onStall;
      const after = options.stallAfterMs;
      later(after, () => onStall(after));
    }
    let sampler: NodeJS.Timeout | undefined;
    if (options.maxRssBytes !== undefined && pid !== undefined && !windows) {
      const ceiling = options.maxRssBytes;
      sampler = setInterval(() => {
        const rss = readGroupRss(pid);
        if (rss === null) {
          return;
        }
        peak = Math.max(peak ?? 0, rss);
        if (rss > ceiling) {
          stop(PROCESS_OUTCOME.memory, 'SIGTERM');
        }
      }, GROUP_DEFAULTS.RSS_POLL_MS);
      sampler.unref();
    }

    const settle = (): void => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      if (sampler !== undefined) {
        clearInterval(sampler);
      }
      options.signal?.removeEventListener('abort', onAbort);
      if (pid !== undefined) {
        LIVE_PROCESS_GROUPS.delete(pid);
      }
    };
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    /** Ждать, пока в группе не останется процессов, — не дольше `ms`. */
    const drained = async (ms: number): Promise<boolean> => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (pid === undefined || !isProcessGroupAlive(pid)) {
          return true;
        }
        await pause(50);
      }
      return pid === undefined || !isProcessGroupAlive(pid);
    };

    child.once('error', (error) => {
      settle();
      reject(error);
    });
    child.once('exit', (status) => {
      void (async () => {
        let leftovers = false;
        if (!windows && pid !== undefined && isProcessGroupAlive(pid)) {
          // Прямой потомок вышел, а группа жива: обёртка без exec, сбежавший
          // воркер, сервер из теста. Снимаются тем же порядком, что и по сигналу.
          if (!stopping) {
            leftovers = true;
            signalGroup('SIGTERM');
          }
          if (!(await drained(graceMs))) {
            signalGroup('SIGKILL');
            await drained(GROUP_DEFAULTS.PIPE_DRAIN_MS);
          }
        }
        settle();
        if (!piped) {
          await Promise.race([pipeClosed, pause(GROUP_DEFAULTS.PIPE_DRAIN_MS)]);
          child.stdout?.destroy();
        }
        resolvePromise({
          status,
          stdout: Buffer.concat(chunks).toString('utf8'),
          outcome,
          peakRssBytes: peak,
          leftovers,
        });
      })();
    });
  });
