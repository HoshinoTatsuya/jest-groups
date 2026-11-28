import { EXIT_CODE } from '../constants/exit-code.constant';
import { JestGroupsError } from '../jest-groups.error';
import { LIVE_PROCESS_GROUPS } from '../process/live-process-groups';
import { signalGroupQuietly } from '../process/signal-group-quietly';
import { spawnProcess } from '../process/spawn-process';
import { runGroups } from '../run-groups';
import type { ToolName } from '../types/tool-name.type';
import { valueText } from '../value-text';
import { loadProjectTypescript } from './load-project-typescript';
import { parseRunnerArgs } from './parse-runner-args';
import { planOnly } from './plan-only';
import { readEnvOptions } from './read-env-options';

/**
 * CLI раннера групп для инструмента `tool`. Сигналы SIGINT/SIGTERM/SIGHUP —
 * остановка: текущая группа снимается ЦЕЛИКОМ (своя группа процессов: jest за
 * обёрткой без exec прежде доигрывал сиротой), следующие не запускаются, кэш
 * сохраняется, код 128 + сигнал. Второй сигнал — SIGKILL группе сразу. SIGHUP
 * нужен отдельно: закрытый терминал шлёт его оболочке, а группа jest — не её
 * задание и сама бы его не получила.
 *
 * Код выхода — через process.exitCode, а не process.exit(): запись в pipe на
 * macOS и Windows асинхронна, и немедленный выход обрезал бы план больше 64 КБ,
 * который читает гейт (`--plan-only`), и хвост журнала.
 */
export const runCli = (tool: ToolName, argv: readonly string[]): void => {
  const usage =
    `использование: ${tool}-groups --out <отчёт.json> [--dry-run] [--merge-coverage <coverage-final.json>] ` +
    '[--junit <отчёт.xml>] [--changed-since <ref>] [--shard <i>/<n>] [--from-group <N> | --failed-only] ' +
    '[--collect-tests] ' +
    `-- <команда ${tool}>`;
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(name, () => {
      if (!controller.signal.aborted) {
        console.error(`[группы ${tool}] ${name}: снимаю текущую группу, следующие не запускаются`);
        controller.abort(name);
        return;
      }
      for (const pid of LIVE_PROCESS_GROUPS) {
        signalGroupQuietly(pid, 'SIGKILL');
      }
    });
  }
  // Выход раннера по любой причине не оставляет запущенных групп.
  process.on('exit', () => {
    for (const pid of LIVE_PROCESS_GROUPS) {
      signalGroupQuietly(pid, 'SIGKILL');
    }
  });
  const main = async (): Promise<void> => {
    if (argv[0] === '--plan-only') {
      const planPath = argv[1];
      if (planPath === undefined) {
        throw new JestGroupsError('--plan-only <план.json>');
      }
      planOnly(planPath);
      return;
    }
    const args = parseRunnerArgs(argv, usage);
    const cwd = process.cwd();
    const project = loadProjectTypescript(cwd);
    if (project.note !== null) {
      console.log(`[группы ${tool}] ${project.note}`);
    }
    await runGroups({
      ...readEnvOptions(process.env),
      tool,
      command: args.command,
      out: args.out,
      cwd,
      dryRun: args.dryRun,
      run: spawnProcess,
      log: (line) => console.log(line),
      typescript: project.typescript,
      signal: controller.signal,
      ...(args.mergeCoverageTo === undefined ? {} : { mergeCoverageTo: args.mergeCoverageTo }),
      ...(args.junitTo === undefined ? {} : { junitTo: args.junitTo }),
      ...(args.changedSince === undefined ? {} : { changedSince: args.changedSince }),
      ...(args.shard === undefined ? {} : { shard: args.shard }),
      ...(args.collectTests ? { collectTests: true } : {}),
      ...(args.fromGroup === undefined && !args.failedOnly
        ? {}
        : { resume: args.fromGroup === undefined ? { failedOnly: true } : { fromGroup: args.fromGroup } }),
    });
  };
  main().then(
    () => {
      process.exitCode = 0;
    },
    (error: unknown) => {
      // Свой отказ — его текст; чужое значение (ошибка из TypeScript проекта и
      // т. п.) — текстом, который сам не бросает: иначе необработанный TypeError
      // из этого обработчика заменил бы отказ стеком.
      const message = error instanceof JestGroupsError ? error.message : valueText(error);
      console.error(`ОТКАЗ раннера групп ${tool}: ${message}`);
      process.exitCode = error instanceof JestGroupsError ? error.exitCode : EXIT_CODE.runner;
    },
  );
};
