/**
 * Как сливается покрытие групп инструмента (`--merge-coverage`).
 *
 * - `runner` — каждая группа пишет `file` (istanbul `coverage-final.json`), раннер сливает их сам
 *   и сверяет порог проекта по слитому (jest: порог из `--showConfig`, текст отказа как у jest).
 * - `tool` — каждая группа пишет `file` (blob-отчёт vitest с покрытием), а сливает и сверяет порог
 *   сам инструмент командой `mergeArgs` (vitest `--merge-reports`): форма порогов и провайдеры у
 *   него свои, и сверка «как у инструмента» иначе была бы выдумкой раннера. Слияние пишет
 *   `coverage-final.json` в `outputDir` и свой JSON-отчёт в `reportPath`.
 */
export type CoverageMerge =
  | { readonly by: 'runner'; readonly file: string }
  | {
      readonly by: 'tool';
      readonly file: string;
      readonly mergeArgs: (options: {
        readonly baseArgs: readonly string[];
        readonly inputsDir: string;
        readonly outputDir: string;
        readonly reportPath: string;
        readonly checkThreshold: boolean;
      }) => string[];
    };
