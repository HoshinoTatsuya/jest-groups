/**
 * Пометка раннера в слитом отчёте. `partial` — отчёт покрывает НЕ всю выборку
 * команды (возобновление, «только изменённое», шард из нескольких): причины
 * через запятую, например `changed-since origin/main, shard 1/2`.
 * `jest-assert-no-skipped` такой отчёт без `--allow-partial` не принимает —
 * иначе быстрый прогон в хуке или одна машина CI выглядели бы проверкой всего
 * набора.
 */
export interface ReportMeta {
  readonly tool: string;
  readonly groups: number;
  readonly partial?: string;
  readonly shard?: string;
  /**
   * Шард (`--shard i/n`): отпечаток раскладки ВСЕХ шардов (одинаков на каждой машине при той же
   * выборке) и файлы этого шарда относительно корня проекта — по ним `jest-groups-merge`
   * проверяет, что отчёты шардов складываются в весь набор ровно по разу.
   */
  readonly plan?: string;
  readonly files?: readonly string[];
  /** Отчёт `jest-groups-merge`: из скольких шардов он склеен. */
  readonly shards?: number;
}
