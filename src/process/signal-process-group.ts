import { spawnSync } from 'node:child_process';

import { assertSignalablePid } from './assert-signalable-pid';

/**
 * Сигнал ВСЕЙ группе процессов, которую возглавляет `pid`: обёртке, jest и его
 * воркерам. Прежде сигнал получал только прямой потомок, и jest за обёрткой
 * без exec (`-- ./scripts/jest.sh`, `sh -c '…; …'`, менеджер пакетов) доигрывал
 * сиротой — с воркерами, на машине, которую раннер обещал не перегружать.
 *
 * Windows групп процессов POSIX не знает: дерево снимается `taskkill /T /F`
 * (мягкого сигнала там нет — консольный Ctrl-C чужому дереву не доставить).
 * Ответ «процесса уже нет» — не ошибка: снимать нечего. pid 0, ±1 и не целые —
 * отказ без сигнала (`kill(-1)` — все процессы пользователя).
 */
export const signalProcessGroup = (
  pid: number,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
  run: typeof spawnSync = spawnSync,
): void => {
  assertSignalablePid(pid);
  if (platform === 'win32') {
    run('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }
};
