import type { ToolAdapter } from '../types/tool-adapter.type';
import { parsePytestCollectOutput } from './parse-pytest-collect-output';
import { readPytestJunit } from './read-pytest-junit';

/**
 * pytest (с pytest-xdist). Выборка — `--collect-only -q`: тесты не
 * исполняются, а число тестов каждого файла известно ТОЧНО (оценка не нужна).
 * Группа — `pytest <файлы> -n <воркеры>`: воркеры — процессы xdist, они
 * потомки pytest и снимаются вместе с его группой процессов. Отчёт — JUnit XML
 * (`junit_family=xunit1`, атрибут `file`), раннер читает его в форме jest.
 * Флаги раннера ищутся и в `PYTEST_ADDOPTS`: pytest дописывает её к аргументам.
 *
 * Пути в команде pytest — выборка, а не фильтр: каталог в команде попал бы в
 * КАЖДУЮ группу (раннер ответит «выполнены не в своей группе»). Выборку
 * задавать `-k`, `-m`, `testpaths` в конфиге. «Только изменённое» pytest сам
 * не умеет — `--changed-since` для него отказ. Покрытие (`--cov`) без слияния —
 * отказ; слияние покрытия pytest не поддержано.
 */
export const PYTEST_TOOL: ToolAdapter = {
  name: 'pytest',
  owned: {
    long: ['numprocesses', 'maxprocesses', 'junitxml', 'looponfail', 'collectonly', 'co'],
    short: ['n', 'f'],
    valuedShort: ['k', 'm', 'p', 'c', 'o', 'r', 'W'],
    words: [],
  },
  coverageFlag: /^--cov(?:=.*)?$/,
  mergesCoverage: false,
  listsTests: true,
  listOkStatuses: [0, 5],
  supportsChangedSince: false,
  argsEnv: 'PYTEST_ADDOPTS',
  listsCopies: false,
  listArgs: (baseArgs) => [...baseArgs, '--collect-only', '-q'],
  parseList: parsePytestCollectOutput,
  readReport: readPytestJunit,
  groupArgs: ({ baseArgs, reportPath, workers, files }) => [
    ...baseArgs,
    '-n',
    String(workers),
    '-o',
    'junit_family=xunit1',
    `--junitxml=${reportPath}`,
    ...files,
  ],
  groupEnv: () => ({}),
  units: (files) => files.map((file) => [file]),
};
