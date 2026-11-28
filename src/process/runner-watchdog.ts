import { ProcessWatchdog } from './process-watchdog';

/** Сторож групп процесса раннера — один на процесс (`spawnProcess` сообщает ему о каждой группе). */
export const RUNNER_WATCHDOG = new ProcessWatchdog();
