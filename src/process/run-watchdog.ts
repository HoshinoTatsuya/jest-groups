import type { Readable } from 'node:stream';

import { isProcessGroupAlive } from './is-process-group-alive';
import { isSignalablePid } from './is-signalable-pid';
import { signalGroupQuietly } from './signal-group-quietly';

/**
 * Тело процесса-сторожа (`watchdog-main`). Из `input` (stdin, pipe раннера) приходят строки
 * `+ <pgid> <graceMs>` — группа запущена — и `- <pgid>` — группа снята. Конец `input` — раннера
 * больше нет: штатно (тогда групп в списке нет) или убитым SIGKILL, который не перехватить. Во
 * втором случае группы jest жили бы дальше — с воркерами, на машине, которую раннер обещал не
 * перегружать; сторож снимает каждую тем же порядком, что раннер: SIGTERM, через `graceMs` —
 * SIGKILL, — и выходит.
 *
 * pid проверяется тем же правилом, что везде (`isSignalablePid`): строка с 0, ±1 или не целым —
 * пропускается, а не превращается в `kill(-1)`. Обещание `done` — сторож закончил.
 */
export const runWatchdog = (input: Readable, pollMs = 100): Promise<void> =>
  new Promise((resolve) => {
    const groups = new Map<number, number>();
    let buffered = '';
    let reaping = false;
    const reap = async (): Promise<void> => {
      if (reaping) {
        return;
      }
      reaping = true;
      const alive = [...groups].filter(([pgid]) => isProcessGroupAlive(pgid));
      for (const [pgid] of alive) {
        signalGroupQuietly(pgid, 'SIGTERM');
      }
      const until = Date.now() + Math.max(0, ...alive.map(([, grace]) => grace));
      while (alive.some(([pgid]) => isProcessGroupAlive(pgid)) && Date.now() < until) {
        await new Promise((wake) => setTimeout(wake, pollMs));
      }
      for (const [pgid] of alive) {
        if (isProcessGroupAlive(pgid)) {
          signalGroupQuietly(pgid, 'SIGKILL');
        }
      }
      resolve();
    };
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const [op, pidText, graceText] = line.trim().split(/\s+/);
        const pgid = Number(pidText);
        // Группа — строго положительный pgid > 1: отрицательное число сделало бы из «группы»
        // одиночный процесс с этим номером (kill(-(-n)) = kill(n)).
        if (!isSignalablePid(pgid) || pgid <= 1) {
          continue;
        }
        if (op === '+') {
          const grace = Number(graceText);
          groups.set(pgid, Number.isSafeInteger(grace) && grace >= 0 ? grace : 10_000);
        } else if (op === '-') {
          groups.delete(pgid);
        }
      }
    });
    input.on('end', () => void reap());
    input.on('close', () => void reap());
    input.on('error', () => void reap());
  });
