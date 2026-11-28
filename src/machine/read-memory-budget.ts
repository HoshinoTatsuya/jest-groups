import { totalmem } from 'node:os';

import type { MemoryBudget } from '../types/memory-budget.type';

/**
 * Сколько памяти есть у раннера и его групп: предел cgroup, если он задан и меньше физической
 * памяти машины, иначе вся физическая память. От этого числа считаются потолок памяти группы
 * и порог свободной памяти по умолчанию.
 *
 * Без предела cgroup контейнер с 4 ГБ на хосте с 64 ГБ получал потолок группы 32 ГБ (половина
 * `os.totalmem()`, а это память хоста) — ядро убивало контейнер по OOM задолго до потолка, — и
 * порог свободной памяти 6,4 ГБ, которого в контейнере не бывает никогда: раннер ждал бы нормы
 * машины до отказа «машина перегружена». `process.constrainedMemory()` возвращает 0, когда
 * предела нет, и огромное число, когда cgroup разрешает «max»: оба случая — «предела нет».
 */
export const readMemoryBudget = (
  total: number = totalmem(),
  constrained: number = process.constrainedMemory(),
): MemoryBudget =>
  Number.isFinite(constrained) && constrained > 0 && constrained < total
    ? { bytes: constrained, source: 'cgroup' }
    : { bytes: total, source: 'machine' };
