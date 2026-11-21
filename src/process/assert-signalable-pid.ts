import { isSignalablePid } from './is-signalable-pid';

/** Отказ ДО `process.kill`/`taskkill` (см. `isSignalablePid`): проверка стоит у вызова, а не у источника pid. */
export const assertSignalablePid = (pid: number): void => {
  if (!isSignalablePid(pid)) {
    throw new RangeError(`pid ${String(pid)} не адресует один процесс или группу: сигнал не послан`);
  }
};
