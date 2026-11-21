import type { JestReport } from './jest-report.type';
import type { JsonFileRead } from './json-file-read.type';
import type { ToolName } from './tool-name.type';

/**
 * Что раннер знает об инструменте: как получить выборку, как запустить группу
 * ровно на своих файлах и какие флаги в команде спорили бы с флагами группы.
 * План групп, кэш, сигналы, потолки и проверки отчёта — общие.
 */
export interface ToolAdapter {
  readonly name: ToolName;
  readonly owned: {
    readonly long: readonly string[];
    readonly short: readonly string[];
    readonly words: readonly string[];
    readonly longPrefixes?: readonly string[];
    readonly valuedShort?: readonly string[];
  };
  /**
   * Выборка перечисляет ТЕСТЫ (запись на тест), а не файлы: число тестов файла
   * известно точно, оценка и кэш для плана не нужны (pytest `--collect-only`).
   */
  readonly listsTests: boolean;
  /** Коды выхода выборки, которые значат «выборка получена» (у pytest 5 — «тестов нет»). */
  readonly listOkStatuses: readonly number[];
  /** Умеет ли инструмент «только изменённое». */
  readonly supportsChangedSince: boolean;
  /** Переменная окружения, которую инструмент дописывает к аргументам (`PYTEST_ADDOPTS`). */
  readonly argsEnv?: string;
  /** Чтение отчёта группы в форме `jest --json`; нет — отчёт и есть JSON jest. */
  readonly readReport?: (path: string, root: string) => JsonFileRead<JestReport>;
  /** Флаг покрытия в команде выборки (без слияния каждая группа затёрла бы предыдущую). */
  readonly coverageFlag: RegExp;
  /** Умеет ли раннер сливать покрытие групп этого инструмента. */
  readonly mergesCoverage: boolean;
  /** Число копий файла (проекты) видно в самой выборке. */
  readonly listsCopies: boolean;
  readonly listArgs: (baseArgs: readonly string[], workers: number, changedSince?: string) => string[];
  readonly parseList: (stdout: string) => string[] | null;
  readonly groupArgs: (options: {
    readonly baseArgs: readonly string[];
    readonly reportPath: string;
    readonly workers: number;
    readonly coverageDir?: string;
    readonly files: readonly string[];
  }) => string[];
  /** Окружение группы поверх унаследованного. */
  readonly groupEnv: (workers: number) => Record<string, string>;
  /**
   * Файлы, которые обязаны идти в ОДНОЙ группе: фильтр инструмента по пути
   * одного захватывает и другие (vitest сравнивает подстрокой). Каждый
   * элемент — неделимая единица плана.
   */
  readonly units: (files: readonly string[]) => string[][];
}
