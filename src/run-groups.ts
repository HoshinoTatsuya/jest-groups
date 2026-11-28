import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { platform as osPlatform, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { assessTests } from './assess-tests';
import { assignShard } from './assign-shard';
import { cacheKey } from './cache/cache-key';
import { isFresh } from './cache/is-fresh';
import { plannedTests } from './cache/planned-tests';
import { readTestCache } from './cache/read-test-cache';
import { writeTestCache } from './cache/write-test-cache';
import { CACHE_DIR_SEGMENTS } from './constants/cache-file.constant';
import { ENV_NAMES } from './constants/env-names.constant';
import { EXIT_CODE } from './constants/exit-code.constant';
import { GROUP_DEFAULTS } from './constants/group-defaults.constant';
import { GROUP_STATUS } from './constants/group-status.constant';
import { JSON_FILE_READ } from './constants/json-file-read.constant';
import { PROCESS_OUTCOME } from './constants/process-outcome.constant';
import { checkCoverageThreshold } from './coverage/check-coverage-threshold';
import { readFileStamp } from './files/read-file-stamp';
import { readJsonFile } from './files/read-json-file';
import { realPath } from './files/real-path';
import { writeAtomically } from './files/write-atomically';
import { JestGroupsError } from './jest-groups.error';
import { waitForMachine } from './machine/wait-for-machine';
import { mergeCoverage } from './merge-coverage';
import { mergeReports } from './merge-reports';
import { planCap } from './plan-cap';
import { planGroups } from './plan-groups';
import { signalExitCode } from './signal-exit-code';
import { splitByArgvBudget } from './split-by-argv-budget';
import { readRunState } from './state/read-run-state';
import { writeRunState } from './state/write-run-state';
import { sumTests } from './sum-tests';
import { toJunitXml } from './to-junit-xml';
import { findOwnedFlags } from './tools/find-owned-flags';
import { parseShowConfigOutput } from './tools/parse-show-config-output';
import { TOOLS } from './tools/tools.constant';
import type { Estimator } from './types/estimator.type';
import type { FileCoverage } from './types/file-coverage.type';
import type { FileStamp } from './types/file-stamp.type';
import type { GroupStatus } from './types/group-status.type';
import type { JestReport } from './types/jest-report.type';
import type { ReportMeta } from './types/report-meta.type';
import type { RunGroupsOptions } from './types/run-groups-options.type';
import type { TestAssessment } from './types/test-assessment.type';
import type { TestEntry } from './types/test-entry.type';
import { valueText } from './value-text';

/**
 * Прогон выборки последовательными группами. Бросает JestGroupsError на любой
 * исход, который нельзя засчитать: пустая выборка, упавшая группа, файл без
 * результата, файл, выполненный дважды или не в своей группе, порог покрытия,
 * снятие группы по времени или памяти, машина не пришла в норму.
 */
export const runGroups = async (options: RunGroupsOptions): Promise<void> => {
  const tool = TOOLS[options.tool ?? 'jest'];
  const label = `[группы ${tool.name}]`;
  const { command, run, log } = options;
  const [executable, ...baseArgs] = command;
  if (executable === undefined) {
    throw new JestGroupsError(`не задана команда ${tool.name} после \`--\``);
  }
  const root = realpathSync(options.cwd);
  const cacheDir = join(root, ...CACHE_DIR_SEGMENTS);
  const key = cacheKey(tool.name, command);

  const owned = findOwnedFlags(baseArgs, tool.owned);
  if (owned.length > 0) {
    throw new JestGroupsError(
      `в команде выборки флаги, которые раннер задаёт каждой группе сам: ${owned.join(' ')} — уберите их ` +
        `(число воркеров — переменная ${ENV_NAMES.WORKERS}, не больше 2)`,
    );
  }
  if (options.mergeCoverageTo !== undefined && !tool.mergesCoverage) {
    throw new JestGroupsError(
      `--merge-coverage для ${tool.name} не поддержан: слияние покрытия — только jest`,
    );
  }
  // Каждая группа — свой процесс, и с общим coverageDirectory следующая
  // затирала покрытие предыдущей: отчёт показывал последнюю группу без единой
  // ошибки. Покрытие — только через слияние раннером.
  if (options.mergeCoverageTo === undefined && baseArgs.some((arg) => tool.coverageFlag.test(arg))) {
    throw new JestGroupsError(
      'покрытие в команде выборки без слияния: каждая группа затёрла бы отчёт предыдущей — ' +
        'уберите флаг из команды и задайте --merge-coverage <coverage-final.json>',
    );
  }
  const resume = options.resume;
  if (options.changedSince !== undefined && !tool.supportsChangedSince) {
    throw new JestGroupsError(
      `--changed-since для ${tool.name} не поддержан: сам инструмент «только изменённое» не умеет`,
    );
  }
  // Переменная, которую инструмент сам дописывает к аргументам (PYTEST_ADDOPTS),
  // — та же команда: флаг раннера в ней спорил бы с флагами группы так же.
  const fromEnv =
    tool.argsEnv === undefined ? [] : (process.env[tool.argsEnv] ?? '').split(/\s+/).filter(Boolean);
  const ownedInEnv = findOwnedFlags(fromEnv, tool.owned);
  if (ownedInEnv.length > 0) {
    throw new JestGroupsError(
      `в ${tool.argsEnv} флаги, которые раннер задаёт каждой группе сам: ${ownedInEnv.join(' ')} — уберите их`,
    );
  }
  if (resume !== undefined && (options.changedSince !== undefined || options.shard !== undefined)) {
    throw new JestGroupsError(
      'возобновление (--from-group, --failed-only) не совмещается с --changed-since и --shard',
    );
  }
  if (options.shard !== undefined) {
    const { index, count } = options.shard;
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < 1 || index > count) {
      throw new JestGroupsError(`--shard ${index}/${count}: нужен номер от 1 до числа шардов`);
    }
  }
  const outputs = [options.out, options.mergeCoverageTo, options.junitTo].filter(
    (path): path is string => path !== undefined,
  );
  if (!options.dryRun) {
    // Отчёт, покрытие и JUnit прошлого прогона — до любой работы: прогон,
    // оборванный раньше записи (сигнал, пустая выборка, упавшая группа без
    // отчёта), иначе оставлял бы на диске зелёный отчёт прошлого, и проверка
    // пропусков прочла бы его как свой.
    for (const path of outputs) {
      rmSync(resolve(path), { force: true });
    }
  }
  const limits = options.limits ?? {};
  const processBase = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(limits.killGraceMs === undefined ? {} : { killGraceMs: limits.killGraceMs }),
    env: tool.groupEnv(options.workers),
  };
  const interruptedError = (stage: string): JestGroupsError =>
    new JestGroupsError(
      `прерван сигналом ${valueText(options.signal?.reason)} ${stage}`,
      signalExitCode(options.signal?.reason),
    );

  const listed = await run(
    executable,
    tool.listArgs(baseArgs, options.workers, options.changedSince),
    'capture',
    { ...processBase, ...(limits.timeoutMs === undefined ? {} : { timeoutMs: limits.timeoutMs }) },
  );
  if (options.signal?.aborted) {
    // Сигнал пришёл во время выборки: это прерывание, а не «выборка не получена».
    throw interruptedError('во время выборки');
  }
  if (listed.outcome === PROCESS_OUTCOME.timeout) {
    throw new JestGroupsError(`выборка «${command.join(' ')}» не уложилась в потолок времени — снята`);
  }
  if (listed.status === null || !tool.listOkStatuses.includes(listed.status)) {
    throw new JestGroupsError(`выборка не получена: «${command.join(' ')}» вышла с кодом ${listed.status}`);
  }
  const paths = tool.parseList(listed.stdout);
  if (paths === null) {
    throw new JestGroupsError(`в выводе выборки «${command.join(' ')}» нет списка файлов`);
  }
  // Файл в нескольких проектах vitest приходит по записи на проект: число
  // копий — сколько раз он вправе выполниться в своей группе.
  const copies = new Map<string, number>();
  for (const path of paths) {
    const file = relative(root, realPath(resolve(root, path)));
    copies.set(file, (copies.get(file) ?? 0) + 1);
  }
  const files = [...copies.keys()].sort();
  // Путь спеки в самой команде jest берёт ВМЕСТЕ с путями группы и гонит
  // файл дважды, двумя воркерами разом. Отказ после прогона («выполнены
  // дважды») запаздывает: двойная нагрузка уже случилась. Здесь — до первой
  // группы. Сверяется с выборкой: значение флага (`--config x.js`) и каталог
  // спекой выборки не являются и не мешают.
  if (tool.name === 'jest') {
    const listed = new Set(files);
    const inCommand = [
      ...new Set(
        baseArgs
          .filter((arg) => !arg.startsWith('-'))
          .map((arg) => relative(root, realPath(resolve(root, arg))))
          .filter((file) => listed.has(file)),
      ),
    ].sort();
    if (inCommand.length > 0) {
      throw new JestGroupsError(
        `пути спек в команде jest: ${inCommand.join(', ')} — jest выполнил бы их дважды ` +
          '(вместе с путями группы). Выборку задавайте --testPathPatterns',
      );
    }
  }
  const meta = (groups: number, partial?: string): ReportMeta => ({
    tool: tool.name,
    groups,
    ...(partial === undefined ? {} : { partial }),
    ...(options.shard === undefined ? {} : { shard: `${options.shard.index}/${options.shard.count}` }),
  });
  // Всё, из-за чего отчёт покрывает не всю выборку команды. Шард — тоже часть:
  // без пометки jest-assert-no-skipped принял бы отчёт одной машины CI за
  // проверку всего набора. Шард 1/1 — весь набор, он не частичный.
  const partialParts = [
    ...(options.changedSince === undefined ? [] : [`changed-since ${options.changedSince}`]),
    ...(resume === undefined
      ? []
      : [resume.fromGroup !== undefined ? `from-group ${resume.fromGroup}` : 'failed-only']),
    ...(options.shard === undefined || options.shard.count === 1
      ? []
      : [`shard ${options.shard.index}/${options.shard.count}`]),
  ];
  const partialReason = partialParts.length === 0 ? undefined : partialParts.join(', ');
  /** Пустой частичный прогон («изменённых спек нет») — отчёт без тестов с пометкой, код 0. */
  const writeEmpty = (why: string): void => {
    log(`${label} ${why} — гнать нечего`);
    if (!options.dryRun) {
      writeAtomically(
        resolve(options.out),
        JSON.stringify({
          numTotalTests: 0,
          numTotalTestSuites: 0,
          success: true,
          testResults: [],
          jestGroups: meta(0, partialReason),
        }),
      );
    }
  };
  // «Пропусков нет» неотличимо от «тестов не найдено», поэтому пустая выборка —
  // отказ (как и без раннера: --passWithNoTests не используется). Исключение —
  // явное «только изменённое»: там пусто значит «ничего не менялось».
  if (files.length === 0) {
    if (options.changedSince !== undefined) {
      writeEmpty(`изменённых с ${options.changedSince} спек нет`);
      return;
    }
    throw new JestGroupsError(`выборка «${command.join(' ')}» пуста: тестов не найдено`);
  }

  // Инструмент, перечисляющий тесты (pytest), даёт ТОЧНОЕ число: оценка и кэш не нужны.
  const exact = tool.listsTests ? new Map(copies) : null;
  if (exact !== null) {
    for (const file of files) {
      copies.set(file, 1);
    }
  }
  // Оценка текста без запаса (на все копии файла) — по разу на файл.
  const assessments = new Map<string, TestAssessment>();
  const estimator: Estimator = options.typescript === null ? 'regex' : 'ast';
  const assessOf = (file: string): TestAssessment => {
    let assessment = assessments.get(file);
    if (assessment === undefined) {
      const raw = assessTests(options.typescript, file, readFileSync(join(root, file), 'utf8'));
      assessment = { tests: raw.tests * (copies.get(file) ?? 1), certain: raw.certain };
      assessments.set(file, assessment);
    }
    return assessment;
  };
  const estimate = (file: string): number =>
    exact?.get(file) ?? Math.ceil(assessOf(file).tests * GROUP_DEFAULTS.ESTIMATE_MARGIN);
  let selected = files;
  if (options.shard !== undefined) {
    const { index, count } = options.shard;
    const weighed = files.map((file) => ({ file, tests: estimate(file) }));
    selected = assignShard(weighed, index, count);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(Array.from({ length: count }, (_, shard) => assignShard(weighed, shard + 1, count))),
      )
      .digest('hex')
      .slice(0, 12);
    log(`${label} шард ${index}/${count}: файлов ${selected.length} из ${files.length}, план ${fingerprint}`);
    if (selected.length === 0) {
      throw new JestGroupsError(
        `шард ${index}/${count} пуст: файлов спек (${files.length}) меньше, чем шардов — уменьшите число машин`,
      );
    }
  }

  const cache = readTestCache(cacheDir, key, command);
  const cacheFiles = { ...cache.files };
  const stamps = new Map<string, FileStamp | null>();
  const stampOf = (file: string): FileStamp | null => {
    if (!stamps.has(file)) {
      stamps.set(file, readFileStamp(join(root, file)));
    }
    return stamps.get(file) ?? null;
  };
  const known = selected.flatMap((file) => {
    const entry = cacheFiles[file];
    return entry?.durationMs === undefined ? [] : [{ tests: entry.tests, ms: entry.durationMs }];
  });
  const knownTests = known.reduce((total, item) => total + item.tests, 0);
  const msPerTest = knownTests > 0 ? known.reduce((total, item) => total + item.ms, 0) / knownTests : 0;
  const cap = planCap(options.maxTests);
  // Оценка того же содержимого, что даст факт этого прогона, — ляжет в кэш
  // рядом с фактом и откалибрует план, когда файл изменится.
  const baselines = new Map<string, number>();
  const entries: TestEntry[] = selected.map((file) => {
    const entry = cacheFiles[file];
    const stamp = stampOf(file);
    const tests = exact?.get(file) ?? plannedTests(entry, stamp, () => assessOf(file), cap, estimator);
    if (exact === null) {
      // Оценка того же содержимого тем же оценщиком; другим — заново.
      const sameEstimator = entry?.estimator === undefined || entry.estimator === estimator;
      baselines.set(
        file,
        (isFresh(entry, stamp) && sameEstimator ? entry?.estimate : undefined) ?? assessOf(file).tests,
      );
    }
    // Время выросшего файла растёт вместе с числом его тестов: иначе второй
    // потолок плана (по времени) считал бы его по прошлому, меньшему набору.
    const durationMs =
      entry?.durationMs === undefined
        ? Math.round(msPerTest * tests)
        : tests > entry.tests
          ? Math.round((entry.durationMs * tests) / entry.tests)
          : entry.durationMs;
    return { file, tests, durationMs };
  });
  const planned = new Map(entries.map(({ file, tests }) => [file, tests]));
  const expected = new Map(entries.map(({ file, durationMs }) => [file, durationMs ?? 0]));
  const work = options.dryRun ? '' : mkdtempSync(join(tmpdir(), 'jest-groups-'));
  const coverageDir = (number: number): string => join(work, `coverage-${number}`);
  const groupArgs = (number: number, reportPath: string, group: readonly string[]): string[] =>
    tool.groupArgs({
      baseArgs,
      reportPath,
      workers: options.workers,
      ...(options.mergeCoverageTo === undefined ? {} : { coverageDir: coverageDir(number) }),
      files: group.map((file) => resolve(root, file)),
    });

  let groups: readonly (readonly string[])[];
  let runIndices: number[];
  const state = resume === undefined ? null : readRunState(cacheDir, key);
  if (resume !== undefined) {
    if (state === null) {
      throw new JestGroupsError('возобновлять нечего: состояния прошлого полного прогона этой команды нет');
    }
    const current = new Set(files);
    const stale = state.groups.flat().filter((file) => !current.has(file));
    if (stale.length > 0) {
      throw new JestGroupsError(
        `план прошлого прогона устарел — файлов нет в выборке: ${stale.join(', ')}; нужен полный прогон`,
      );
    }
    groups = state.groups;
    if (resume.fromGroup !== undefined) {
      if (!Number.isInteger(resume.fromGroup) || resume.fromGroup < 1 || resume.fromGroup > groups.length) {
        throw new JestGroupsError(`--from-group ${resume.fromGroup}: в прошлом плане групп ${groups.length}`);
      }
      runIndices = groups.map((_, index) => index).filter((index) => index >= (resume.fromGroup ?? 1) - 1);
    } else {
      runIndices = groups
        .map((_, index) => index)
        .filter((index) => state.statuses[index] !== GROUP_STATUS.passed);
    }
    // План прошлого прогона — по прошлым числам. Файл, выросший с тех пор,
    // вывел бы его группу за потолок факта: такой план не возобновляется.
    const over = runIndices.filter((index) => sumTests(groups[index] ?? [], planned) > options.maxTests);
    if (over.length > 0) {
      const detail = over
        .map((index) => {
          const group = groups[index] ?? [];
          const files = group.map((file) => `${file} ${planned.get(file) ?? 0}`).join(', ');
          return (
            `группа ${index + 1} прошлого плана вышла бы за потолок ${options.maxTests}: ` +
            `по нынешнему плану ${sumTests(group, planned)} тестов (${files})`
          );
        })
        .join('; ');
      throw new JestGroupsError(`${detail} — файлы изменились с прошлого прогона, нужен полный прогон`);
    }
  } else {
    // Единицы плана: файлы, которые фильтр путей инструмента захватывает вместе.
    const units = tool.units(selected);
    const unitOf = new Map(units.map((unit) => [unit[0] ?? '', unit]));
    const unitEntries = units.map((unit) => ({
      file: unit[0] ?? '',
      tests: unit.reduce((total, file) => total + (planned.get(file) ?? 0), 0),
      durationMs: unit.reduce((total, file) => total + (expected.get(file) ?? 0), 0),
    }));
    const byUnits = planGroups(unitEntries, cap, limits.maxDurationMs).map((group) =>
      group.flatMap((head) => unitOf.get(head) ?? [head]).sort(),
    );
    const byteLength = (arg: string): number => Buffer.byteLength(arg) + 1;
    // Длина общей части — с самым длинным номером группы, какой может выйти.
    const fixed = [executable, ...groupArgs(entries.length, join(work, `group-${entries.length}.json`), [])]
      .map(byteLength)
      .reduce((total, length) => total + length, 0);
    const budget =
      options.argvBudgetBytes ??
      (osPlatform() === 'win32'
        ? GROUP_DEFAULTS.ARGV_BUDGET_BYTES.win32
        : GROUP_DEFAULTS.ARGV_BUDGET_BYTES.other);
    groups = splitByArgvBudget(byUnits, budget, fixed, (file) => byteLength(resolve(root, file)));
    runIndices = groups.map((_, index) => index);
  }

  if (options.dryRun) {
    for (const index of runIndices) {
      const group = groups[index] ?? [];
      log(`группа ${index + 1}: файлов ${group.length}, тестов по плану ${sumTests(group, planned)}`);
    }
  }
  const runFiles = runIndices.flatMap((index) => [...(groups[index] ?? [])]).sort();
  log(
    `${label} файлов ${runFiles.length}, тестов по плану ${sumTests(runFiles, planned)}, ` +
      `групп ${runIndices.length}${resume === undefined ? '' : ` из ${groups.length} (возобновление)`} ` +
      `(до ${options.maxTests} тестов, по плану до ${cap}, воркеров ${options.workers}, последовательно)`,
  );
  if (options.dryRun) {
    return;
  }
  if (runIndices.length === 0) {
    rmSync(work, { recursive: true, force: true });
    writeEmpty('все группы прошлого прогона прошли');
    return;
  }
  if (limits.maxRssBytes !== undefined && osPlatform() === 'win32') {
    log(`${label} потолок памяти группы на Windows не действует: групп процессов POSIX там нет`);
  }

  /** Порог покрытия проекта — из `--showConfig` (конфиг и флаги команды); его снимают в группах. */
  let threshold: Record<string, Record<string, number>> | null = null;
  let projects: number | null = null;
  let jestVersion: string | null = null;
  const showConfig = async (): Promise<ReturnType<typeof parseShowConfigOutput>> => {
    const shown = await run(executable, [...baseArgs, '--showConfig'], 'capture', processBase);
    return shown.status === 0 ? parseShowConfigOutput(shown.stdout) : null;
  };
  if (options.mergeCoverageTo !== undefined) {
    const shown = await showConfig();
    if (shown === null) {
      throw new JestGroupsError(
        `порог покрытия не прочитан: «${command.join(' ')} --showConfig» не дал конфига — без него ` +
          'порог пришлось бы сверять в каждой группе по части покрытия',
      );
    }
    threshold = shown.coverageThreshold;
    projects = shown.projects;
    jestVersion = shown.version;
  }

  const statuses: GroupStatus[] =
    state === null ? groups.map(() => GROUP_STATUS.notRun) : [...state.statuses];
  // Состояние пишет только полный прогон (и возобновление — свои группы):
  // план частичного прогона не годится для «продолжить с группы N».
  const keepsState = state !== null || (options.changedSince === undefined && options.shard === undefined);
  const saveState = (): void => {
    if (keepsState) {
      writeRunState(cacheDir, key, { version: 1, command, groups, statuses });
    }
  };
  saveState();

  const reports: JestReport[] = [];
  const executedIn = new Map<string, number>();
  const twice = new Set<string>();
  const outside = new Set<string>();
  const oversized: string[] = [];
  const coverages: Record<string, FileCoverage>[] = [];
  let failedGroup = 0;
  let fatal: string | undefined;
  let interrupted: unknown;
  try {
    for (const [position, index] of runIndices.entries()) {
      const group = groups[index] ?? [];
      const number = index + 1;
      const counter = `${position + 1}/${runIndices.length}`;
      if (options.signal?.aborted) {
        interrupted = options.signal.reason;
        break;
      }
      if (options.machine !== undefined) {
        await waitForMachine(options.machine, log, options.signal);
        if (options.signal?.aborted) {
          interrupted = options.signal.reason;
          break;
        }
      }
      for (const file of group) {
        stampOf(file);
      }
      const reportPath = join(work, `group-${number}.json`);
      const expectedMs = group.reduce((total, file) => total + (expected.get(file) ?? 0), 0);
      const started = Date.now();
      const result = await run(executable, groupArgs(number, reportPath, group), 'inherit', {
        ...processBase,
        ...(limits.timeoutMs === undefined ? {} : { timeoutMs: limits.timeoutMs }),
        ...(limits.maxRssBytes === undefined ? {} : { maxRssBytes: limits.maxRssBytes }),
        ...(expectedMs > 0
          ? {
              stallAfterMs: Math.max(
                GROUP_DEFAULTS.STALL_FLOOR_S * 1000,
                GROUP_DEFAULTS.STALL_FACTOR * expectedMs,
              ),
              onStall: (elapsed: number) =>
                log(
                  `${label} группа ${number} идёт ${Math.round(elapsed / 1000)} с при ожидаемых ` +
                    `${Math.round(expectedMs / 1000)} с — похоже на зависший тест (потолок — ${ENV_NAMES.TIMEOUT})`,
                ),
            }
          : {}),
      });
      if (options.signal?.aborted) {
        // Группа прервана на середине: её отчёт (если jest успел) неполон, и
        // засчитывать его нельзя; факты завершённых групп уже в кэше.
        interrupted = options.signal.reason;
        statuses[index] = GROUP_STATUS.interrupted;
        break;
      }
      if (result.outcome === PROCESS_OUTCOME.timeout) {
        fatal =
          `группа ${number}: снята по потолку времени ${Math.round((limits.timeoutMs ?? 0) / 1000)} с ` +
          `(${ENV_NAMES.TIMEOUT}) — зависший тест или незакрытый дескриптор`;
        statuses[index] = GROUP_STATUS.failed;
        break;
      }
      if (result.outcome === PROCESS_OUTCOME.memory) {
        fatal =
          `группа ${number}: снята по потолку памяти ${Math.round((limits.maxRssBytes ?? 0) / 2 ** 20)} МБ ` +
          `(${ENV_NAMES.MAX_RSS}) — тяжёлая спека или утечка`;
        statuses[index] = GROUP_STATUS.failed;
        break;
      }
      const read = tool.readReport?.(reportPath, root) ?? readJsonFile<JestReport>(reportPath);
      if (read.kind === JSON_FILE_READ.missing) {
        throw new JestGroupsError(`группа ${number}: ${tool.name} не записал отчёт (код ${result.status})`);
      }
      if (read.kind === JSON_FILE_READ.invalid) {
        throw new JestGroupsError(
          `группа ${number}: отчёт записан, но ${read.reason} (код ${result.status}) — ` +
            `запись прервана или отчёт пишет не ${tool.name}`,
        );
      }
      const report = read.value;
      reports.push(report);
      // Покрытие, включённое КОНФИГОМ (collectCoverage, coverage.enabled),
      // раннер в команде не видит: каждая группа сверяла бы порог по своей
      // части и затирала отчёт предыдущей.
      if (options.mergeCoverageTo === undefined && report.coverageMap !== undefined) {
        throw new JestGroupsError(
          `группа ${number}: покрытие собирается конфигом проекта — без слияния каждая группа затёрла бы ` +
            'отчёт предыдущей и сверяла порог по части. Задайте --merge-coverage <coverage-final.json> ' +
            'или выключите покрытие в конфиге',
        );
      }
      if (options.mergeCoverageTo !== undefined) {
        const coverage = readJsonFile<Record<string, FileCoverage>>(
          join(coverageDir(number), 'coverage-final.json'),
        );
        if (coverage.kind === JSON_FILE_READ.missing) {
          throw new JestGroupsError(
            `группа ${number}: jest не записал покрытие (coverage-final.json) — в конфиге свои coverageReporters?`,
          );
        }
        if (coverage.kind === JSON_FILE_READ.invalid) {
          throw new JestGroupsError(
            `группа ${number}: покрытие coverage-final.json записано, но ${coverage.reason}`,
          );
        }
        coverages.push(coverage.value);
      }
      const members = new Set(group);
      const seen = new Map<string, { runs: number; tests: number; ms: number }>();
      for (const suite of report.testResults ?? []) {
        const file = relative(root, realPath(suite.name));
        const extra = suite as unknown as { startTime?: unknown; endTime?: unknown };
        const ms =
          typeof extra.startTime === 'number' && typeof extra.endTime === 'number'
            ? Math.max(0, extra.endTime - extra.startTime)
            : 0;
        const known = seen.get(file) ?? { runs: 0, tests: 0, ms: 0 };
        seen.set(file, {
          runs: known.runs + 1,
          tests: known.tests + (suite.assertionResults ?? []).length,
          ms: known.ms + ms,
        });
      }
      for (const [file, fact] of seen) {
        if (executedIn.has(file)) {
          twice.add(file);
        }
        executedIn.set(file, number);
        if (!members.has(file)) {
          outside.add(file);
        }
        if (fact.runs > 1) {
          // Несколько копий в одной группе — законно, если файл входит в
          // столько проектов; иначе это позиционный путь в команде.
          if (!tool.listsCopies && projects === null) {
            projects = (await showConfig())?.projects ?? 1;
          }
          const allowed = tool.listsCopies ? (copies.get(file) ?? 1) : (projects ?? 1);
          if (fact.runs > allowed) {
            twice.add(file);
          }
        }
        const stamp = stampOf(file);
        // Сьют, который не собрался, тестов не показывает: его число неизвестно,
        // и прежнее значение кэша остаётся.
        if (fact.tests > 0 && stamp !== null) {
          const baseline = baselines.get(file);
          cacheFiles[file] = {
            tests: fact.tests,
            mtimeMs: stamp.mtimeMs,
            size: stamp.size,
            durationMs: fact.ms,
            ...(baseline === undefined ? {} : { estimate: baseline, estimator }),
          };
        }
      }
      const total = report.numTotalTests ?? 0;
      const seconds = Math.round((Date.now() - started) / 1000);
      const memory =
        result.peakRssBytes === undefined || result.peakRssBytes === null
          ? ''
          : `, память до ${Math.round(result.peakRssBytes / 2 ** 20)} МБ`;
      log(
        `[группа ${number}, ${counter}] файлов ${group.length}, тестов ${total} ` +
          `(план ${sumTests(group, planned)}) — ${result.status === 0 ? 'ок' : 'ОТКАЗ'} за ${seconds} с${memory}`,
      );
      if (result.leftovers === true) {
        log(
          `${label} после группы ${number} в её группе процессов остались процессы — сняты (утечка из теста?)`,
        );
      }
      if (total > options.maxTests) {
        // Потолок — предел ФАКТА: превышение называет файлы, выросшие против
        // плана (их факт уже в кэше), — сразу, а не только в итоге прогона.
        const grown = [...seen]
          .filter(([file, fact]) => fact.tests > (planned.get(file) ?? 0))
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([file, fact]) => `${file} ${fact.tests} (план ${planned.get(file) ?? 0})`);
        const line =
          `группа ${number}: ${total} тестов (план ${sumTests(group, planned)}) — ` +
          (grown.length > 0
            ? `больше плана: ${grown.join(', ')}`
            : group.length === 1
              ? `файл ${group[0]} один тяжелее потолка — разделите его`
              : `файлы: ${group.join(', ')}`);
        oversized.push(line);
        log(`${label} потолок факта ${options.maxTests} превышен: ${line}`);
      }
      statuses[index] = result.status === 0 ? GROUP_STATUS.passed : GROUP_STATUS.failed;
      saveState();
      if (result.status !== 0 && failedGroup === 0) {
        failedGroup = number;
        if (!options.keepGoing) {
          break;
        }
      }
    }
  } finally {
    writeTestCache(cacheDir, key, { version: 2, command, files: cacheFiles }, root);
    saveState();
    rmSync(work, { recursive: true, force: true });
  }

  if (interrupted !== undefined) {
    // Отчёт не пишется: неполный прогон, записанный как отчёт, следующая
    // проверка прочла бы как настоящий.
    throw new JestGroupsError(
      `прерван сигналом ${valueText(interrupted)}: завершено групп ${reports.length} из ${runIndices.length}, ` +
        'кэш сохранён',
      signalExitCode(interrupted),
    );
  }
  if (fatal !== undefined) {
    throw new JestGroupsError(`${fatal}; кэш сохранён, отчёт не записан`);
  }
  const merged =
    reports.length > 0 ? { ...mergeReports(reports), jestGroups: meta(reports.length, partialReason) } : null;
  if (merged !== null) {
    writeAtomically(resolve(options.out), JSON.stringify(merged));
    if (options.junitTo !== undefined) {
      writeAtomically(resolve(options.junitTo), toJunitXml(merged, root));
    }
  }
  let thresholdErrors: string[] = [];
  if (options.mergeCoverageTo !== undefined && coverages.length > 0) {
    const coverage = mergeCoverage(coverages);
    writeAtomically(resolve(options.mergeCoverageTo), JSON.stringify(coverage));
    const complete = reports.length === runIndices.length && partialReason === undefined;
    if (threshold !== null && complete) {
      thresholdErrors = checkCoverageThreshold(coverage, threshold, root, jestVersion);
    } else if (threshold !== null) {
      log(`${label} порог покрытия не сверяется: прогон покрыл не весь набор`);
    }
  }
  // Превышение — в журнале всегда; отказом — последним: упавшие тесты (код 1)
  // и негодный отчёт важнее, и их не должно заслонять.
  const ceilingBreach =
    oversized.length > 0
      ? `больше ${options.maxTests} тестов вышло в: ${oversized.join('; ')} — потолок факта превышен; ` +
        'кэш обновлён фактами всех групп, следующий запуск разобьёт по ним'
      : null;
  if (ceilingBreach !== null) {
    log(`${label} ${ceilingBreach}`);
  }
  if (failedGroup > 0) {
    throw new JestGroupsError(
      options.keepGoing
        ? `упала группа ${failedGroup} (и, возможно, следующие) — подробности выше`
        : `упала группа ${failedGroup} из ${groups.length}, остальные не запускались`,
      EXIT_CODE.testsFailed,
    );
  }
  if (thresholdErrors.length > 0) {
    for (const line of thresholdErrors) {
      log(line);
    }
    throw new JestGroupsError(thresholdErrors.join('\n'), EXIT_CODE.testsFailed);
  }
  // Файл, выполненный в двух группах, — почти всегда позиционный путь в команде
  // после `--`: jest берёт его И пути группы и гонит файл двумя воркерами разом.
  // Спеки с общим Redis и фиксированными ключами затирают друг друга — выглядит флаком.
  if (twice.size > 0) {
    throw new JestGroupsError(
      `файлы выполнены дважды: ${[...twice].join(', ')} — путь спеки в команде после \`--\`? ` +
        'Выборку задавайте --testPathPatterns',
    );
  }
  if (outside.size > 0) {
    throw new JestGroupsError(
      `файлы выполнены не в своей группе: ${[...outside].join(', ')} — фильтр путей ${tool.name} ` +
        'захватил чужие файлы, группа вышла за план',
    );
  }
  const missing = runFiles.filter((file) => !executedIn.has(file));
  if (missing.length > 0) {
    throw new JestGroupsError(`файлы выборки не выполнены ни в одной группе: ${missing.join(', ')}`);
  }
  if (ceilingBreach !== null && options.strictCeiling !== false) {
    throw new JestGroupsError(`${ceilingBreach} (только строкой в журнале — ${ENV_NAMES.STRICT}=0)`);
  }
};
