import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { LoadedModule } from '../types/loaded-module.type';
import { valueText } from '../value-text';

/**
 * Модуль `id`, как его увидел бы код проекта в `cwd`. Не найден САМ модуль —
 * его нет; любой другой отказ (битая установка, не найдена его зависимость) —
 * отдельный ответ с причиной, а не «нет».
 */
export const loadProjectModule = (cwd: string, id: string): LoadedModule => {
  try {
    return { kind: 'loaded', module: createRequire(join(cwd, 'package.json'))(id) };
  } catch (error) {
    // Поля, а не instanceof Error: ошибка из другого контекста (vm, песочница
    // jest) не наследует здешний Error.
    // Бросающий геттер поля — полей нет: отказ остаётся «не загрузился», а не TypeError.
    let code: unknown;
    let raw: unknown;
    try {
      ({ code, message: raw } = (error ?? {}) as { code?: unknown; message?: unknown });
    } catch {
      code = undefined;
    }
    const message = typeof raw === 'string' ? raw : valueText(error);
    return code === 'MODULE_NOT_FOUND' && message.startsWith(`Cannot find module '${id}'`)
      ? { kind: 'missing' }
      : { kind: 'failed', message: message.split('\n')[0] ?? message };
  }
};
