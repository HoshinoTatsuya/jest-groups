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
 * Слияние покрытия vitest раннер не делает (отказ на `--merge-coverage`):
 * формат порогов и провайдеры другие, а сверка «как у инструмента» без этого
 * была бы своей выдумкой.
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
  mergesCoverage: false,
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
  groupArgs: ({ baseArgs, reportPath, workers, files }) => [
    ...baseArgs,
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
    `--maxWorkers=${workers}`,
    '--silent=true',
    ...files,
  ],
  groupEnv: (workers) => ({ VITEST_MAX_WORKERS: String(workers) }),
  units: vitestFilterUnits,
};
