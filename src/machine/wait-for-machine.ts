import { JestGroupsError } from '../jest-groups.error';
import type { MachineGate } from '../types/machine-gate.type';
import { describeOverload } from './describe-overload';

/**
 * Перед группой — ждать нормы машины. Потолок числа тестов защищает косвенно:
 * нагрузку задают тяжёлые спеки и ЧУЖИЕ процессы (сборка, второй набор), и
 * группа, стартовавшая на занятой машине, — ровно «ноутбук глохнет». Норма не
 * пришла за `maxWaitMs` — отказ (код раннера), а не старт «всё равно»:
 * молчаливый старт на перегруженной машине и есть то, от чего защита.
 *
 * Отмена (`signal`) прерывает ожидание сразу. Возвращает, сколько ждали, мс.
 */
export const waitForMachine = async (
  gate: MachineGate,
  log: (line: string) => void,
  signal?: AbortSignal,
): Promise<number> => {
  const started = gate.now();
  let announced = false;
  for (;;) {
    if (signal?.aborted) {
      return gate.now() - started;
    }
    const reasons = describeOverload(gate.probe(), gate);
    if (reasons.length === 0) {
      return gate.now() - started;
    }
    const waited = gate.now() - started;
    if (waited >= gate.maxWaitMs) {
      throw new JestGroupsError(
        `машина не пришла в норму за ${Math.round(gate.maxWaitMs / 1000)} с (${reasons.join('; ')}) — ` +
          'группа не запущена. Освободите машину или поправьте пороги JEST_GROUP_MIN_FREE_MB / ' +
          'JEST_GROUP_MAX_LOAD_PERCENT',
      );
    }
    if (!announced) {
      log(`[группы jest] жду нормы машины перед группой: ${reasons.join('; ')}`);
      announced = true;
    }
    await gate.sleep(Math.min(gate.pollMs, gate.maxWaitMs - waited));
  }
};
