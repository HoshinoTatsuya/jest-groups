import { assertSignalablePid } from './assert-signalable-pid';

/**
 * Есть ли в группе `pgid` хоть один процесс. `kill(-pgid, 0)` сигнала не шлёт,
 * только проверяет: ESRCH — группы нет, EPERM — есть, но чужая (тоже «жива»).
 */
export const isProcessGroupAlive = (pgid: number): boolean => {
  assertSignalablePid(pgid);
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};
