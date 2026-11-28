import { JestGroupsError } from '../jest-groups.error';
import type { MachineGate } from '../types/machine-gate.type';
import type { MachineLoad } from '../types/machine-load.type';
import { describeOverload } from './describe-overload';
import { readMemoryBudget } from './read-memory-budget';
import { waitForMachine } from './wait-for-machine';

const GB = 1024 ** 3;
const load = (freeGb: number, load1: number | null): MachineLoad => ({
  freeBytes: freeGb * GB,
  totalBytes: 16 * GB,
  load1,
  cores: 10,
});

/** Норма машины на поддельных часах: время идёт только сном ожидания. */
const gate = (readings: MachineLoad[]): MachineGate & { slept: number[]; probes: () => number } => {
  let clock = 0;
  let index = 0;
  const slept: number[] = [];
  return {
    minFreeBytes: 2 * GB,
    maxLoadPercent: 150,
    maxWaitMs: 10_000,
    pollMs: 2_000,
    probe: () => readings[Math.min(index++, readings.length - 1)] ?? load(0, null),
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    slept,
    probes: () => index,
  };
};

describe('describeOverload', () => {
  it('в норме — пусто; на границе — ещё в норме', () => {
    expect(describeOverload(load(2, 15), gate([]))).toEqual([]);
  });

  it('памяти мало и load average высок — обе причины, с числами', () => {
    expect(describeOverload(load(1, 15.1), gate([]))).toEqual([
      'свободной памяти 1024 МБ < 2048 МБ',
      'load average 15.1 > 15.0 (10 ядер)',
    ]);
  });

  it('load average не измеряется (Windows) — не причина', () => {
    expect(describeOverload(load(4, null), gate([]))).toEqual([]);
  });
});

describe('waitForMachine', () => {
  it('машина в норме — ни одного сна', async () => {
    const machine = gate([load(4, 1)]);
    expect(await waitForMachine(machine, () => undefined)).toBe(0);
    expect(machine.slept).toEqual([]);
  });

  it('ждёт, пока норма не придёт; сообщает один раз', async () => {
    const machine = gate([load(1, 1), load(1, 1), load(4, 1)]);
    const lines: string[] = [];
    expect(await waitForMachine(machine, (line) => lines.push(line))).toBe(4_000);
    expect(machine.slept).toEqual([2_000, 2_000]);
    expect(lines).toEqual([
      '[группы jest] жду нормы машины перед группой: свободной памяти 1024 МБ < 2048 МБ',
    ]);
  });

  it('норма не пришла за потолок — отказ раннера, последний сон укорочен до потолка', async () => {
    const machine = gate([load(1, 30)]);
    const failure = waitForMachine({ ...machine, maxWaitMs: 5_000 }, () => undefined);
    await expect(failure).rejects.toThrow(JestGroupsError);
    await expect(
      waitForMachine({ ...gate([load(1, 30)]), maxWaitMs: 5_000 }, () => undefined),
    ).rejects.toThrow(
      'машина не пришла в норму за 5 с (свободной памяти 1024 МБ < 2048 МБ; load average 30.0 > 15.0 (10 ядер))',
    );
    expect(machine.slept).toEqual([2_000, 2_000, 1_000]);
  });

  it('отмена прерывает ожидание сразу', async () => {
    const controller = new AbortController();
    const machine = gate([load(1, 1)]);
    const waiting = waitForMachine(
      {
        ...machine,
        sleep: async (ms) => {
          controller.abort('SIGTERM');
          await machine.sleep(ms);
        },
      },
      () => undefined,
      controller.signal,
    );
    await expect(waiting).resolves.toBe(2_000);
    expect(machine.probes()).toBe(1);
  });
});

describe('readMemoryBudget', () => {
  it('предел cgroup меньше памяти машины — он и есть память раннера', () => {
    expect(readMemoryBudget(64 * GB, 4 * GB)).toEqual({ bytes: 4 * GB, source: 'cgroup' });
  });

  it.each([
    ['предела нет (0)', 0],
    ['cgroup «max» (огромное число)', 2 ** 64],
    ['предел равен памяти машины', 16 * GB],
    ['предел больше памяти машины', 32 * GB],
    ['непонятное значение', Number.NaN],
    ['отрицательное', -1],
  ])('%s — физическая память машины', (_, constrained) => {
    expect(readMemoryBudget(16 * GB, constrained)).toEqual({ bytes: 16 * GB, source: 'machine' });
  });
});
