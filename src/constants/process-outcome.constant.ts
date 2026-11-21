import { deepFreeze } from '../deep-freeze';

/**
 * Чем закончился процесс группы. Различаются, потому что лечатся по-разному:
 * упавшие тесты — код, снятие по времени — зависший тест, по памяти — тяжёлая
 * спека, по сигналу — внешняя остановка.
 */
export const PROCESS_OUTCOME = {
  exited: 'exited',
  aborted: 'aborted',
  timeout: 'timeout',
  memory: 'memory',
} as const;

deepFreeze(PROCESS_OUTCOME);
