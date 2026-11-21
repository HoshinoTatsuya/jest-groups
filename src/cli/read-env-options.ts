import { totalmem } from 'node:os';

import { ENV_LIMITS } from '../constants/env-limits.constant';
import { ENV_NAMES } from '../constants/env-names.constant';
import { GROUP_DEFAULTS } from '../constants/group-defaults.constant';
import { readMachineLoad } from '../machine/read-machine-load';
import { readBoundedInt } from '../read-bounded-int';
import type { RunGroupsOptions } from '../types/run-groups-options.type';

/**
 * Настройки раннера из окружения — каждая в своих пределах (`ENV_LIMITS`):
 * за пределом — отказ. Потолок памяти не выше физической памяти машины.
 */
export const readEnvOptions = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Pick<RunGroupsOptions, 'maxTests' | 'workers' | 'keepGoing' | 'strictCeiling' | 'limits' | 'machine'> & {
  readonly argvBudgetBytes: number;
} => {
  const MB = 1024 * 1024;
  const read = (name: keyof typeof ENV_LIMITS, fallback: number): number =>
    readBoundedInt(env[name], fallback, name, ENV_LIMITS[name]);
  const totalMb = Math.floor(totalmem() / MB);
  const maxRssMb = read(ENV_NAMES.MAX_RSS, Math.floor(totalMb * GROUP_DEFAULTS.MAX_RSS_SHARE));
  if (maxRssMb > totalMb) {
    throw new Error(
      `${ENV_NAMES.MAX_RSS} — не больше физической памяти (${totalMb} МБ), получено ${maxRssMb}`,
    );
  }
  const platformBudget =
    platform === 'win32' ? GROUP_DEFAULTS.ARGV_BUDGET_BYTES.win32 : GROUP_DEFAULTS.ARGV_BUDGET_BYTES.other;
  const maxSeconds = env[ENV_NAMES.MAX_SECONDS];
  return {
    maxTests: read(ENV_NAMES.MAX_TESTS, GROUP_DEFAULTS.MAX_TESTS),
    workers: read(ENV_NAMES.WORKERS, GROUP_DEFAULTS.WORKERS),
    keepGoing: env[ENV_NAMES.KEEP_GOING] === '1',
    strictCeiling: read(ENV_NAMES.STRICT, 1) === 1,
    argvBudgetBytes: readBoundedInt(env[ENV_NAMES.ARGV_BUDGET], platformBudget, ENV_NAMES.ARGV_BUDGET, {
      min: 1,
      max: platformBudget,
    }),
    limits: {
      timeoutMs: read(ENV_NAMES.TIMEOUT, GROUP_DEFAULTS.TIMEOUT_S) * 1000,
      killGraceMs: read(ENV_NAMES.KILL_GRACE, GROUP_DEFAULTS.KILL_GRACE_S) * 1000,
      maxRssBytes: maxRssMb * MB,
      ...(maxSeconds === undefined || maxSeconds === ''
        ? {}
        : { maxDurationMs: read(ENV_NAMES.MAX_SECONDS, 1) * 1000 }),
    },
    machine: {
      minFreeBytes:
        read(
          ENV_NAMES.MIN_FREE,
          Math.max(GROUP_DEFAULTS.MIN_FREE_FLOOR_MB, Math.floor(totalMb * GROUP_DEFAULTS.MIN_FREE_SHARE)),
        ) * MB,
      maxLoadPercent: read(ENV_NAMES.MAX_LOAD, GROUP_DEFAULTS.MAX_LOAD_PERCENT),
      maxWaitMs: read(ENV_NAMES.MACHINE_WAIT, GROUP_DEFAULTS.MACHINE_WAIT_S) * 1000,
      pollMs: GROUP_DEFAULTS.MACHINE_POLL_MS,
      probe: () => readMachineLoad(platform),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
  };
};
