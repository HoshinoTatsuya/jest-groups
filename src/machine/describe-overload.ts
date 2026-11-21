import type { MachineGate } from '../types/machine-gate.type';
import type { MachineLoad } from '../types/machine-load.type';

/** Почему машина сейчас не в норме; пусто — в норме. */
export const describeOverload = (load: MachineLoad, gate: MachineGate): string[] => {
  const MB = 1024 * 1024;
  const reasons: string[] = [];
  if (load.freeBytes < gate.minFreeBytes) {
    reasons.push(
      `свободной памяти ${Math.round(load.freeBytes / MB)} МБ < ${Math.round(gate.minFreeBytes / MB)} МБ`,
    );
  }
  const ceiling = (load.cores * gate.maxLoadPercent) / 100;
  if (load.load1 !== null && load.load1 > ceiling) {
    reasons.push(`load average ${load.load1.toFixed(1)} > ${ceiling.toFixed(1)} (${load.cores} ядер)`);
  }
  return reasons;
};
