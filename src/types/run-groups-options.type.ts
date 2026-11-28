import type { MachineGate } from './machine-gate.type';
import type { ProcessRunner } from './process-runner.type';
import type { ToolName } from './tool-name.type';
import type { TypescriptApi } from './typescript-api.type';

export interface RunGroupsOptions {
  /** Команда выборки: `["node_modules/.bin/jest", "--config", "jest.db.config.js"]`. */
  readonly command: readonly string[];
  /** Инструмент команды; по умолчанию jest. */
  readonly tool?: ToolName;
  /** Куда записать слитый отчёт в форме `jest --json`. */
  readonly out: string;
  /** Корень проекта: от него считаются пути и лежит кэш. */
  readonly cwd: string;
  readonly maxTests: number;
  readonly workers: number;
  /** Не останавливаться на первой упавшей группе. */
  readonly keepGoing: boolean;
  /** Напечатать план и выйти, ничего не запуская. */
  readonly dryRun: boolean;
  readonly run: ProcessRunner;
  readonly log: (line: string) => void;
  /**
   * JS API TypeScript для оценки по тексту; null — оценка регуляркой. Для
   * проекта на TypeScript 7 — `@typescript/typescript6` (`loadProjectTypescript`
   * выбирает сам), главный вход `typescript` 7 — отказ.
   */
  readonly typescript: TypescriptApi | null;
  /**
   * Прерывание (SIGINT/SIGTERM/SIGHUP): текущая группа снимается целиком,
   * следующие не запускаются, кэш с фактами завершённых групп сохраняется,
   * наружу — JestGroupsError с кодом 128 + сигнал. Причина отмены — имя сигнала.
   */
  readonly signal?: AbortSignal;
  /** Потолок длины аргументов одного запуска jest, байт (GROUP_DEFAULTS.ARGV_BUDGET_BYTES). */
  readonly argvBudgetBytes?: number;
  /**
   * Куда записать слитое покрытие (`coverage-final.json` istanbul). Каждая
   * группа пишет своё в рабочий каталог раннера; порог покрытия проекта
   * (`coverageThreshold`) в группах снят и сверяется раннером по слитому.
   */
  readonly mergeCoverageTo?: string;
  /** Куда записать JUnit XML по всем группам. */
  readonly junitTo?: string;
  /**
   * Группа, в которой ФАКТ тестов превысил `maxTests`, — отказ (код раннера)
   * после всех групп; `false` — только строка в журнале. По умолчанию — отказ.
   * Кэш фактами обновляется в любом случае.
   */
  readonly strictCeiling?: boolean;
  /**
   * Только изменённое: выборка — спеки, изменённые относительно ссылки git
   * (и связанные с изменёнными файлами — как решит инструмент), дальше обычный
   * план групп. Флаг уходит только в выборку: группа гонит ровно свои пути.
   */
  readonly changedSince?: string;
  /** Шард CI (с 1): план делится детерминированно по оценке из текста. */
  readonly shard?: { readonly index: number; readonly count: number };
  /**
   * Сосчитать тесты файлов без истории, чьё число текст не доказывает (тесты строит функция,
   * таблица из импорта), самим jest — `--collectTests` (jest 30.4+). Как при прогоне, выполняются
   * среда тестов, `setupFiles`, `setupFilesAfterEnv` и верхний уровень спек; `globalSetup`, тела
   * тестов и хуки — нет; покрытие не собирается. Без этого такой файл планируется полной группой
   * и идёт один. Только jest; с `dryRun` пропускается.
   */
  readonly collectTests?: boolean;
  /** Возобновление по состоянию прошлого прогона той же команды. */
  readonly resume?: { readonly fromGroup?: number; readonly failedOnly?: boolean };
  /** Потолки процесса группы. */
  readonly limits?: {
    readonly timeoutMs?: number;
    readonly killGraceMs?: number;
    readonly maxRssBytes?: number;
    /** Потолок длительности группы по плану (кэш времени файлов), мс. */
    readonly maxDurationMs?: number;
  };
  /** Норма машины перед каждой группой; нет — не ждать. */
  readonly machine?: MachineGate;
}
