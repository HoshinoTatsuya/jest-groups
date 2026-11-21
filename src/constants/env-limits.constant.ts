import { deepFreeze } from '../deep-freeze';

/**
 * Пределы числовых переменных раннера (включительно). Верхний предел тестов и
 * воркеров — обещание раннера (≤300 тестов, ≤2 воркера), а не подбор: без
 * него `JEST_GROUP_WORKERS=16` в окружении CI или в `.envrc` возвращал бы
 * ровно тот запуск, который 09.11.2026 отправил ноутбук в перезагрузку.
 * Остальные пределы отсекают значения, при которых защита перестаёт значить
 * что-либо (потолок времени в сутки, ожидание нормы машины в час).
 */
export const ENV_LIMITS = {
  JEST_GROUP_MAX_TESTS: { min: 1, max: 300 },
  JEST_GROUP_WORKERS: { min: 1, max: 2 },
  JEST_GROUP_TIMEOUT_S: { min: 1, max: 4 * 3600 },
  JEST_GROUP_KILL_GRACE_S: { min: 1, max: 120 },
  JEST_GROUP_MAX_RSS_MB: { min: 64, max: 1024 * 1024 },
  JEST_GROUP_MIN_FREE_MB: { min: 0, max: 1024 * 1024 },
  JEST_GROUP_MAX_LOAD_PERCENT: { min: 10, max: 1000 },
  JEST_GROUP_MACHINE_WAIT_S: { min: 1, max: 3600 },
  JEST_GROUP_MAX_SECONDS: { min: 1, max: 4 * 3600 },
  /** 1 — факт сверх потолка отказ (по умолчанию), 0 — строка в журнале. */
  JEST_GROUPS_STRICT: { min: 0, max: 1 },
} as const;

deepFreeze(ENV_LIMITS);
