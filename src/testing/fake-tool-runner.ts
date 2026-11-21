import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProcessResult, ProcessRunner } from '../types/process-runner.type';
import type { RunProcessOptions } from '../types/run-process-options.type';

/**
 * Поддельный jest В ПРОЦЕССЕ спеки — порт `ProcessRunner` для `runGroups`:
 * отдаёт выборку, конфиг (`--showConfig`) и пишет отчёт группы по заданным
 * числам тестов. Каждый вызов записан (аргументы и ограничения), так что
 * проверяется и то, ЧТО раннер передал процессу.
 */
export class FakeToolRunner {
  public readonly calls: { args: readonly string[]; options: RunProcessOptions | undefined }[] = [];
  /** Число тестов на файл (абсолютный путь). */
  public counts: Record<string, number> = {};
  public projects = 1;
  public threshold: unknown;
  /** Версия jest в `--showConfig`; undefined — поля нет (обёртка без версии). */
  public version: string | undefined;
  /** Файл → код выхода группы, в которой он есть. */
  public failing = new Set<string>();
  /** Исход процесса группы по номеру вызова группы (с 1). */
  public outcomes = new Map<number, ProcessResult['outcome']>();
  /** Файл → сколько раз он попадает в отчёт своей группы (проекты). */
  public copies: Record<string, number> = {};
  /** Файлы, которые отчёт группы добавляет сверх своих путей. */
  public extra: string[] = [];
  /** Покрытие группы: файл исходника → счётчик операторов. */
  public coverageOf: ((files: readonly string[]) => Record<string, unknown>) | null = null;
  public reportExtra: Record<string, unknown> = {};
  public leftovers = false;
  private groupCalls = 0;

  /** Забыть вызовы: следующий запуск группы снова первый (для `outcomes`). */
  public reset(): void {
    this.calls.length = 0;
    this.groupCalls = 0;
  }

  public groups(): string[][] {
    return this.calls
      .filter((call) => call.args.includes('--runTestsByPath'))
      .map((call) => [...call.args.slice(call.args.indexOf('--runTestsByPath') + 1)]);
  }

  public readonly run: ProcessRunner = async (_executable, args, _mode, options) => {
    this.calls.push({ args, options });
    if (args.includes('--listTests')) {
      return { status: 0, stdout: `шум\n${JSON.stringify(Object.keys(this.counts))}\n` };
    }
    if (args.includes('--showConfig')) {
      return {
        status: 0,
        stdout: JSON.stringify(
          {
            configs: Array.from({ length: this.projects }, () => ({})),
            globalConfig: { coverageThreshold: this.threshold },
            ...(this.version === undefined ? {} : { version: this.version }),
          },
          null,
          2,
        ),
      };
    }
    this.groupCalls++;
    const outcome = this.outcomes.get(this.groupCalls);
    if (outcome !== undefined) {
      return { status: null, stdout: '', outcome };
    }
    const report = args.find((arg) => arg.startsWith('--outputFile='))?.slice('--outputFile='.length) ?? '';
    const files = [...args.slice(args.indexOf('--runTestsByPath') + 1), ...this.extra];
    const suites = files.flatMap((file) =>
      Array.from({ length: this.copies[file] ?? 1 }, () => ({
        name: file,
        startTime: 1_000,
        endTime: 1_000 + 10 * (this.counts[file] ?? 1),
        assertionResults: Array.from({ length: this.counts[file] ?? 1 }, (_, index) => ({
          status: this.failing.has(file) && index === 0 ? 'failed' : 'passed',
          fullName: `t${index}`,
        })),
      })),
    );
    const failed = suites
      .flatMap((suite) => suite.assertionResults)
      .filter((test) => test.status === 'failed').length;
    writeFileSync(
      report,
      JSON.stringify({
        numTotalTests: suites.reduce((total, suite) => total + suite.assertionResults.length, 0),
        numFailedTests: failed,
        success: failed === 0,
        testResults: suites,
        ...this.reportExtra,
      }),
    );
    const coverageDir = args
      .find((arg) => arg.startsWith('--coverageDirectory='))
      ?.slice('--coverageDirectory='.length);
    if (coverageDir !== undefined && this.coverageOf !== null) {
      mkdirSync(coverageDir, { recursive: true });
      writeFileSync(join(coverageDir, 'coverage-final.json'), JSON.stringify(this.coverageOf(files)));
    }
    return {
      status: failed === 0 ? 0 : 1,
      stdout: '',
      outcome: 'exited',
      peakRssBytes: 300 * 2 ** 20,
      leftovers: this.leftovers,
    };
  };
}
