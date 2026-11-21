import { spawnSync } from 'node:child_process';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';

import type { MachineLoad } from '../types/machine-load.type';

/**
 * Показания машины. Свободная память меряется по-разному, потому что
 * `os.freemem()` на macOS — только совсем пустые страницы (на 16 ГБ ноутбуке
 * замерено 127 МБ при 50 % доступной памяти): по нему раннер ждал бы вечно.
 * На macOS — `kern.memorystatus_level` (процент памяти, доступной без
 * давления, — то же число печатает `memory_pressure`), на Linux — меньшее из
 * MemAvailable (`os.freemem`) и предела cgroup (`process.availableMemory`),
 * на Windows — `os.freemem` (там это доступная память).
 */
export const readMachineLoad = (platform: NodeJS.Platform = process.platform): MachineLoad => {
  const totalBytes = totalmem();
  let freeBytes = freemem();
  if (platform === 'darwin') {
    const level = Number(
      spawnSync('sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' }).stdout?.trim(),
    );
    if (Number.isFinite(level) && level > 0 && level <= 100) {
      freeBytes = Math.round((totalBytes * level) / 100);
    }
  } else if (platform === 'linux') {
    freeBytes = Math.min(freeBytes, process.availableMemory());
  }
  return {
    freeBytes,
    totalBytes,
    load1: platform === 'win32' ? null : (loadavg()[0] ?? null),
    cores: availableParallelism(),
  };
};
