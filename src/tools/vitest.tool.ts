import { join } from 'node:path';

import type { ToolAdapter } from '../types/tool-adapter.type';
import { parseVitestListOutput } from './parse-vitest-list-output';
import { vitestFilterUnits } from './vitest-filter-units';

/**
 * vitest (4.x). Выборка — `vitest list --filesOnly --json` (файлы не
 * исполняются), группа — `vitest run <файлы>` с отчётом в форме `jest --json`
 * (JSON-репортёр vitest пишет ту же форму). Воркеры — и флагом, и
 * `VITEST_MAX_WORKERS`: переменная применяется при разборе конфига КАЖДОГО
 * проекта, а `maxWorkers` в конфиге проекта иначе побеждал бы флаг корня.
 *
 * Покрытие (`--merge-coverage`) сливает сам vitest: каждая группа пишет blob-отчёт с покрытием и
 * с выключенным порогом (`--coverage.thresholds=false` — иначе группа, видящая часть покрытия,
 * выходила с кодом 1 при зелёных тестах), а в конце `vitest run --merge-reports` сливает blob'ы
 * и сверяет пороги конфига (global, perFile, glob) по слитому покрытию — своим провайдером и
 * своим текстом. Проверено на vitest 4.1 и 5.1: порог 90 % при 50 % в каждой группе и 100 % у
 * набора — группы зелёные, слияние зелёное; слияние одной группы — отказ.
 */
export const VITEST_TOOL: ToolAdapter = {
  name: 'vitest',
  owned: {
    long: ['maxworkers', 'minworkers', 'watch', 'shard', 'ui', 'standalone', 'mergereports'],
    short: ['w'],
    words: ['run', 'watch', 'dev', 'list', 'bench', 'related', 'init', 'typecheck'],
    longPrefixes: ['pooloptions', 'outputfile', 'reporter'],
  },
  coverageFlag: /^--coverage(?:\.enabled)?(?:=(?:true|1))?$/,
  coverageMerge: {
    by: 'tool',
    file: 'blob.json',
    mergeArgs: ({ baseArgs, inputsDir, outputDir, reportPath, checkThreshold }) => [
      ...baseArgs,
      'run',
      `--merge-reports=${inputsDir}`,
      '--coverage.enabled=true',
      '--coverage.reporter=json',
      `--coverage.reportsDirectory=${outputDir}`,
      '--reporter=json',
      `--outputFile.json=${reportPath}`,
      ...(checkThreshold ? [] : ['--coverage.thresholds=false']),
    ],
  },
  listsTests: false,
  listOkStatuses: [0],
  supportsChangedSince: true,
  listsCopies: true,
  listArgs: (baseArgs, workers, changedSince) => [
    ...baseArgs,
    'list',
    '--filesOnly',
    '--json',
    `--maxWorkers=${workers}`,
    ...(changedSince === undefined ? [] : [`--changed=${changedSince}`]),
  ],
  parseList: parseVitestListOutput,
  groupArgs: ({ baseArgs, reportPath, workers, coverageDir, files }) => [
    ...baseArgs,
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
    ...(coverageDir === undefined
      ? []
      : [
          '--reporter=blob',
          `--outputFile.blob=${join(coverageDir, 'blob.json')}`,
          '--coverage.enabled=true',
          '--coverage.reporter=json',
          `--coverage.reportsDirectory=${join(coverageDir, 'raw')}`,
          '--coverage.thresholds=false',
        ]),
    `--maxWorkers=${workers}`,
    '--silent=true',
    ...files,
  ],
  groupEnv: (workers) => ({ VITEST_MAX_WORKERS: String(workers) }),
  units: vitestFilterUnits,
};
