import { parseListTestsOutput } from '../parse-list-tests-output';
import type { ToolAdapter } from '../types/tool-adapter.type';
import { withoutFlag } from './without-flag';

/**
 * jest. Группа — `--runTestsByPath <пути>`: пути буквальные, без сопоставления
 * шаблоном, поэтому каждый файл — своя единица плана. `--ci` — новые снимки не
 * пишутся молча. Порог покрытия в группах снят (`--coverageThreshold={}`):
 * группа видит часть покрытия и падала бы ложно (25 % при 100 % у набора) —
 * порог сверяет раннер по слитому покрытию, тем же текстом, что jest.
 */
export const JEST_TOOL: ToolAdapter = {
  name: 'jest',
  owned: {
    long: ['maxworkers', 'runinband', 'watch', 'watchall', 'shard', 'json', 'outputfile', 'collecttests'],
    short: ['w', 'i'],
    words: [],
  },
  coverageFlag: /^--(?:coverage|collectCoverage|collect-coverage)(?:=(?:true|1))?$/,
  coverageMerge: { by: 'runner', file: 'coverage-final.json' },
  listsTests: false,
  listOkStatuses: [0],
  supportsChangedSince: true,
  listsCopies: false,
  listArgs: (baseArgs, _workers, changedSince) => [
    ...baseArgs,
    '--listTests',
    '--json',
    ...(changedSince === undefined ? [] : [`--changedSince=${changedSince}`]),
  ],
  parseList: parseListTestsOutput,
  groupArgs: ({ baseArgs, reportPath, workers, coverageDir, files }) => [
    ...(coverageDir === undefined ? baseArgs : withoutFlag(baseArgs, 'coverageThreshold')),
    '--ci',
    '--silent',
    '--json',
    `--outputFile=${reportPath}`,
    `--maxWorkers=${workers}`,
    ...(coverageDir === undefined
      ? []
      : [
          '--coverage',
          '--coverageReporters=json',
          `--coverageDirectory=${coverageDir}`,
          '--coverageThreshold={}',
        ]),
    '--runTestsByPath',
    ...files,
  ],
  groupEnv: () => ({}),
  units: (files) => files.map((file) => [file]),
};
