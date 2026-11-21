import { deepFreeze } from './deep-freeze';
import type { FileCoverage } from './types/file-coverage.type';

const sumCounters = (
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): Record<string, number> => {
  const result: Record<string, number> = { ...(left ?? {}) };
  for (const [key, value] of Object.entries(right ?? {})) {
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
};

const sumBranches = (
  left: Record<string, number[]> | undefined,
  right: Record<string, number[]> | undefined,
): Record<string, number[]> => {
  const result: Record<string, number[]> = { ...(left ?? {}) };
  for (const [key, value] of Object.entries(right ?? {})) {
    const known = result[key] ?? [];
    result[key] = Array.from({ length: Math.max(known.length, value.length) }, (_, index) => {
      return (known[index] ?? 0) + (value[index] ?? 0);
    });
  }
  return result;
};

/** Платформа, на которой написания пути одного файла сводятся к одному ключу. */
export const COVERAGE_PATH_PLATFORM = { win32: 'win32' } as const;

export interface MergeCoverageOptions {
  /** Платформа путей отчётов; по умолчанию — `process.platform`. */
  readonly platform?: string;
}

/** Буква диска в начале пути Windows: `c:` и `C:` — один диск. */
const DRIVE_LETTER = /^([a-zA-Z]):/;

/**
 * Ключ файла для слияния. На win32 один и тот же файл приходит в отчёты под
 * разными написаниями — `C:/src/a.ts` и `C:\src\a.ts`, `c:\…` и `C:\…`
 * (инструмент, cwd из другой оболочки, отчёт из WSL-обёртки), — и без
 * сведения он попадал бы в слитый файл дважды, каждый раз с частью счётчиков.
 * Сводятся ТОЛЬКО разделители и буква диска — то, что Windows различать не
 * умеет. Регистр остального пути НЕ сводится: каталог NTFS бывает
 * регистрозависимым (`fsutil … setCaseSensitiveInfo`, каталоги WSL), и
 * `Foo.ts` с `foo.ts` там — два файла; их сложение по номерам операторов
 * молча испортило бы покрытие обоих, а дубль хотя бы виден. Вне win32 путь не
 * трогается вовсе: `\` в имени файла POSIX — обычный символ, а регистр macOS и
 * Linux различают (APFS бывает регистрозависимой).
 */
const coverageKey = (file: string, platform: string): string =>
  platform === COVERAGE_PATH_PLATFORM.win32
    ? file.replaceAll('/', '\\').replace(DRIVE_LETTER, (_, drive: string) => `${drive.toUpperCase()}:`)
    : file;

/**
 * Слияние покрытия групп. Каждая группа — свой процесс jest, и с общим
 * `coverageDirectory` следующая затирала отчёт предыдущей: покрытие показывало
 * последнюю группу, то есть было ЗАНИЖЕНО без единой ошибки. Файл, покрытый в
 * нескольких группах, складывается по счётчикам (карты операторов у одного
 * исходника совпадают). Написания пути одного файла на win32 сводятся к одному
 * ключу (см. `coverageKey`), поле `path` — к нему же.
 */
export const mergeCoverage = (
  reports: readonly Record<string, FileCoverage>[],
  options: MergeCoverageOptions = {},
): Record<string, FileCoverage> => {
  const platform = options.platform ?? process.platform;
  const merged: Record<string, FileCoverage> = {};
  for (const report of reports) {
    for (const [file, raw] of Object.entries(report)) {
      const key = coverageKey(file, platform);
      const coverage =
        typeof raw.path === 'string' && coverageKey(raw.path, platform) !== raw.path
          ? { ...raw, path: coverageKey(raw.path, platform) }
          : raw;
      const known = merged[key];
      merged[key] =
        known === undefined
          ? coverage
          : {
              ...known,
              s: sumCounters(known.s, coverage.s),
              f: sumCounters(known.f, coverage.f),
              b: sumBranches(known.b, coverage.b),
              ...(known.bT === undefined && coverage.bT === undefined
                ? {}
                : { bT: sumBranches(known.bT, coverage.bT) }),
            };
    }
  }
  return merged;
};

deepFreeze(COVERAGE_PATH_PLATFORM);
