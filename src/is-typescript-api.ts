import { TYPESCRIPT_API_MEMBERS } from './constants/typescript-api-members.constant';
import type { TypescriptApi } from './types/typescript-api.type';

/**
 * Модуль — JS API TypeScript, которым умеет пользоваться оценка: есть КАЖДАЯ
 * нужная функция и каждый нужный член перечисления. Главный вход TypeScript 7
 * (`{ version, versionMajorMinor }`) — не API.
 */
export const isTypescriptApi = (candidate: unknown): candidate is TypescriptApi => {
  if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
    return false;
  }
  const module = candidate as Record<string, unknown>;
  return (
    TYPESCRIPT_API_MEMBERS.functions.every((name) => typeof module[name] === 'function') &&
    Object.entries(TYPESCRIPT_API_MEMBERS.enums).every(([name, members]) => {
      const values = module[name];
      return (
        typeof values === 'object' &&
        values !== null &&
        members.every((member) => typeof (values as Record<string, unknown>)[member] === 'number')
      );
    })
  );
};
