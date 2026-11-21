/**
 * Пометка раннера в слитом отчёте. `partial` — отчёт покрывает НЕ всю выборку
 * команды (возобновление, «только изменённое»): `jest-assert-no-skipped` такой
 * отчёт без `--allow-partial` не принимает — иначе быстрый прогон в хуке
 * выглядел бы проверкой всего набора.
 */
export interface ReportMeta {
  readonly tool: string;
  readonly groups: number;
  readonly partial?: string;
  readonly shard?: string;
}
