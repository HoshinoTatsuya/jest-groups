import { deepFreeze } from '../deep-freeze';

/**
 * Переменные окружения раннера. Каждая числовая — в пределах `ENV_LIMITS`:
 * значение за пределом — отказ, а не «как попросили». Поднять потолок тестов
 * или воркеров нельзя — это ровно то, от чего раннер существует.
 */
export const ENV_NAMES = {
  MAX_TESTS: 'JEST_GROUP_MAX_TESTS',
  WORKERS: 'JEST_GROUP_WORKERS',
  KEEP_GOING: 'JEST_GROUPS_KEEP_GOING',
  /** Потолок длины аргументов одного запуска jest, байт (по умолчанию — по платформе). */
  ARGV_BUDGET: 'JEST_GROUP_ARGV_BUDGET',
  /** `1` — группа больше потолка тестов (факт, не план) — отказ раннера, а не строка в журнале. */
  STRICT: 'JEST_GROUPS_STRICT',
  /** Потолок времени одной группы, секунд: дольше — группа снимается, отказ раннера. */
  TIMEOUT: 'JEST_GROUP_TIMEOUT_S',
  /** Сколько ждать выхода после SIGTERM, прежде чем снять группу SIGKILL, секунд. */
  KILL_GRACE: 'JEST_GROUP_KILL_GRACE_S',
  /** Потолок суммарной памяти (RSS) процессов группы, МБ: больше — группа снимается. */
  MAX_RSS: 'JEST_GROUP_MAX_RSS_MB',
  /** Перед группой ждать, пока свободной памяти станет не меньше, МБ. */
  MIN_FREE: 'JEST_GROUP_MIN_FREE_MB',
  /** Перед группой ждать, пока load average за минуту станет не больше (×100 на ядро). */
  MAX_LOAD: 'JEST_GROUP_MAX_LOAD_PERCENT',
  /** Сколько ждать нормы машины перед группой, секунд: дольше — отказ. */
  MACHINE_WAIT: 'JEST_GROUP_MACHINE_WAIT_S',
  /** Потолок длительности группы ПО ПЛАНУ (из кэша времени файлов), секунд. */
  MAX_SECONDS: 'JEST_GROUP_MAX_SECONDS',
} as const;

deepFreeze(ENV_NAMES);
