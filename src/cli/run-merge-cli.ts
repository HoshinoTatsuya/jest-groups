import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXIT_CODE } from '../constants/exit-code.constant';
import { JSON_FILE_READ } from '../constants/json-file-read.constant';
import { checkCoverageThreshold } from '../coverage/check-coverage-threshold';
import { readJsonFile } from '../files/read-json-file';
import { writeAtomically } from '../files/write-atomically';
import { JestGroupsError } from '../jest-groups.error';
import { mergeCoverage } from '../merge-coverage';
import { mergeShardReports } from '../merge-shard-reports';
import { spawnProcess } from '../process/spawn-process';
import { toJunitXml } from '../to-junit-xml';
import { parseShowConfigOutput } from '../tools/parse-show-config-output';
import type { FileCoverage } from '../types/file-coverage.type';
import type { JestReport } from '../types/jest-report.type';
import type { ProcessRunner } from '../types/process-runner.type';
import type { ReportMeta } from '../types/report-meta.type';
import { valueText } from '../value-text';

/**
 * CLI `jest-groups-merge`: склейка отчётов шардов CI в отчёт всего набора (`mergeShardReports`),
 * по желанию — JUnit и покрытие шардов jest с порогом проекта по слитому. Прежние отчёт, JUnit и
 * покрытие удаляются до работы: отказ не оставит устаревший зелёный отчёт для
 * `jest-assert-no-skipped`. Коды: 0 — склеено, 1 — порог покрытия не выполнен, 2 — отказ.
 */
export const runMergeCli = (
  argv: readonly string[],
  run: ProcessRunner = spawnProcess,
  log: (line: string) => void = (line) => console.log(line),
): Promise<number> => {
  const USAGE =
    'использование: jest-groups-merge --out <отчёт.json> [--junit <отчёт.xml>] ' +
    '[--merge-coverage <coverage-final.json> --coverage <покрытие шарда>…] <отчёт шарда>… ' +
    '[-- <команда jest>, нужна с --merge-coverage: из неё читается порог]';
  const main = async (): Promise<number> => {
    const separator = argv.indexOf('--');
    const own = separator < 0 ? argv : argv.slice(0, separator);
    const command = separator < 0 ? [] : argv.slice(separator + 1);
    const valued = new Map<string, string>();
    const coverageInputs: string[] = [];
    const reports: string[] = [];
    for (let index = 0; index < own.length; index++) {
      const flag = own[index] ?? '';
      if (['--out', '--junit', '--merge-coverage', '--coverage'].includes(flag)) {
        const value = own[++index];
        if (value === undefined || value === '' || value.startsWith('--')) {
          throw new JestGroupsError(`${flag} без значения; ${USAGE}`);
        }
        if (flag === '--coverage') {
          coverageInputs.push(value);
        } else {
          valued.set(flag, value);
        }
      } else if (flag.startsWith('-')) {
        throw new JestGroupsError(`неизвестный флаг «${flag}»; ${USAGE}`);
      } else {
        reports.push(flag);
      }
    }
    const out = valued.get('--out');
    if (out === undefined) {
      throw new JestGroupsError(`не задан --out <отчёт.json>; ${USAGE}`);
    }
    const junitTo = valued.get('--junit');
    const mergeCoverageTo = valued.get('--merge-coverage');
    for (const path of [out, junitTo, mergeCoverageTo]) {
      if (path !== undefined) {
        rmSync(resolve(path), { force: true });
      }
    }
    if (mergeCoverageTo === undefined && coverageInputs.length > 0) {
      throw new JestGroupsError(`--coverage без --merge-coverage; ${USAGE}`);
    }
    const inputs = reports.map((path) => {
      const read = readJsonFile<JestReport>(path);
      if (read.kind === JSON_FILE_READ.missing) {
        throw new JestGroupsError(`отчёт шарда ${path} не найден`);
      }
      if (read.kind === JSON_FILE_READ.invalid) {
        throw new JestGroupsError(`отчёт шарда ${path} не прочитан: ${read.reason}`);
      }
      return { path, report: read.value };
    });
    const merged = mergeShardReports(inputs);
    const meta = merged.jestGroups as ReportMeta;

    let thresholdErrors: string[] = [];
    if (mergeCoverageTo !== undefined) {
      if (meta.tool !== 'jest') {
        throw new JestGroupsError(
          `склейка покрытия шардов — только jest: пороги ${meta.tool} сверяет сам ${meta.tool} своим слиянием`,
        );
      }
      const repeatedCoverage = coverageInputs.filter(
        (path, index) => coverageInputs.findIndex((other) => resolve(other) === resolve(path)) !== index,
      );
      if (repeatedCoverage.length > 0) {
        throw new JestGroupsError(
          `покрытие шарда задано дважды: ${repeatedCoverage.join(', ')} — вместо покрытия другого шарда? ` +
            'Слитое было бы частью набора',
        );
      }
      if (coverageInputs.length !== inputs.length) {
        throw new JestGroupsError(
          `покрытий шардов ${coverageInputs.length}, отчётов ${inputs.length} — у каждого шарда своё ` +
            '(--merge-coverage шарда); без одного слитое покрытие было бы частью набора',
        );
      }
      const [executable, ...args] = command;
      if (executable === undefined) {
        throw new JestGroupsError(
          `с --merge-coverage нужна команда jest после «--»: из её --showConfig читается порог; ${USAGE}`,
        );
      }
      const coverages = coverageInputs.map((path) => {
        const read = readJsonFile<Record<string, FileCoverage>>(path);
        if (read.kind !== JSON_FILE_READ.ok) {
          throw new JestGroupsError(
            `покрытие шарда ${path} ${read.kind === JSON_FILE_READ.missing ? 'не найдено' : `не прочитано: ${read.reason}`}`,
          );
        }
        return read.value;
      });
      const coverage = mergeCoverage(coverages);
      const shown = await run(executable, [...args, '--showConfig'], 'capture');
      const config = shown.status === 0 ? parseShowConfigOutput(shown.stdout) : null;
      if (config === null) {
        throw new JestGroupsError(
          `порог покрытия не прочитан: «${command.join(' ')} --showConfig» не дал конфига`,
        );
      }
      writeAtomically(resolve(mergeCoverageTo), JSON.stringify(coverage));
      if (config.coverageThreshold === null) {
        log('[склейка шардов] порога покрытия в конфиге нет — сверять нечего');
      } else if (meta.partial !== undefined) {
        log(`[склейка шардов] порог покрытия не сверяется: склеенный отчёт частичный (${meta.partial})`);
      } else {
        thresholdErrors = checkCoverageThreshold(
          coverage,
          config.coverageThreshold,
          process.cwd(),
          config.version,
        );
      }
    } else if (command.length > 0) {
      throw new JestGroupsError(`команда после «--» нужна только с --merge-coverage; ${USAGE}`);
    }

    writeAtomically(resolve(out), JSON.stringify(merged));
    if (junitTo !== undefined) {
      writeAtomically(resolve(junitTo), toJunitXml(merged, process.cwd()));
    }
    log(
      `[склейка шардов] шардов ${meta.shards}, групп ${meta.groups}, тестов ${merged.numTotalTests ?? 0}` +
        (meta.partial === undefined ? '' : ` — частичный: ${meta.partial}`),
    );
    if (thresholdErrors.length > 0) {
      for (const line of thresholdErrors) {
        console.error(line);
      }
      return EXIT_CODE.testsFailed;
    }
    return 0;
  };
  return main().catch((error: unknown) => {
    const message = error instanceof JestGroupsError ? error.message : valueText(error);
    console.error(`ОТКАЗ склейки шардов: ${message}`);
    return error instanceof JestGroupsError ? error.exitCode : EXIT_CODE.runner;
  });
};
