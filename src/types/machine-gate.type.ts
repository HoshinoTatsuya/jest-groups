import type { MachineLoad } from './machine-load.type';

/**
 * Норма машины перед группой и порт к часам и показаниям — тесты гоняют
 * ожидание без реальной машины и реального времени.
 */
export interface MachineGate {
  readonly minFreeBytes: number;
  /** Потолок load average за минуту, % на ядро. */
  readonly maxLoadPercent: number;
  readonly maxWaitMs: number;
  readonly pollMs: number;
  readonly probe: () => MachineLoad;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}
