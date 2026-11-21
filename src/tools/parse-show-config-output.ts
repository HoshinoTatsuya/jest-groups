import { findLastJson } from '../find-last-json';

/**
 * Из вывода `jest --showConfig`: число проектов, порог покрытия (глобальный
 * конфиг, с учётом флагов команды) и версия jest (по ней — текст отказа
 * порога). null — вывода той формы нет.
 */
export const parseShowConfigOutput = (
  stdout: string,
): {
  readonly projects: number;
  readonly coverageThreshold: Record<string, Record<string, number>> | null;
  readonly version: string | null;
} | null => {
  const config = findLastJson(
    stdout,
    '{',
    (value): value is { configs: unknown[]; globalConfig: Record<string, unknown>; version?: unknown } =>
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as { configs?: unknown }).configs) &&
      typeof (value as { globalConfig?: unknown }).globalConfig === 'object' &&
      (value as { globalConfig?: unknown }).globalConfig !== null,
  );
  if (config === null) {
    return null;
  }
  const threshold = config.globalConfig.coverageThreshold;
  return {
    projects: config.configs.length,
    coverageThreshold:
      typeof threshold === 'object' && threshold !== null
        ? (threshold as Record<string, Record<string, number>>)
        : null,
    version: typeof config.version === 'string' ? config.version : null,
  };
};
