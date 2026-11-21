import { readFileSync } from 'node:fs';

import { findRunFailures } from './find-run-failures';
import { findSkippedTests } from './find-skipped-tests';
import type { JestReport } from './types/jest-report.type';
import type { ReportMeta } from './types/report-meta.type';

/**
 * Проверка отчёта для `jest-assert-no-skipped`: прогон успешен (ни упавших
 * тестов, ни упавших сьютов), ни одного пропущенного теста и хотя бы один
 * выполненный. «Пропусков нет» неотличимо от «тестов не найдено», поэтому
 * пустой отчёт — отказ. Частичный отчёт раннера (`jestGroups.partial`:
 * возобновление, «только изменённое») — отказ без `allowPartial`: иначе
 * быстрый прогон выглядел бы проверкой всего набора; с ним пустой частичный
 * («изменённых спек нет») — не отказ.
 *
 * Коды: 0 — чисто, 1 — тесты, 2 — отчёт не прочитан (прогон не дошёл до отчёта).
 */
export const checkReportFile = (
  path: string,
  allowPartial: boolean,
): { readonly exitCode: 0 | 1 | 2; readonly lines: readonly string[] } => {
  let report: JestReport;
  try {
    report = JSON.parse(readFileSync(path, 'utf8')) as JestReport;
  } catch (error) {
    return {
      exitCode: 2,
      lines: [`ОТКАЗ: отчёт ${path} не прочитан: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const meta = report.jestGroups as ReportMeta | undefined;
  const partial = typeof meta?.partial === 'string' ? meta.partial : undefined;
  if (partial !== undefined && !allowPartial) {
    return {
      exitCode: 1,
      lines: [
        `ОТКАЗ: отчёт частичный (${partial}) — он не покрывает весь набор; ` +
          'для быстрого прогона задайте --allow-partial явно',
      ],
    };
  }
  if ((report.numTotalTests ?? 0) === 0) {
    if (partial !== undefined && Array.isArray(report.testResults) && report.testResults.length === 0) {
      return { exitCode: 0, lines: [`Частичный прогон (${partial}): выполнять было нечего`] };
    }
    return { exitCode: 1, lines: ['ОТКАЗ: jest не нашёл ни одного теста'] };
  }
  const failures = findRunFailures(report);
  if (failures.length > 0) {
    return { exitCode: 1, lines: ['ОТКАЗ: прогон не успешен', ...failures.map((line) => `  ${line}`)] };
  }
  const skipped = findSkippedTests(report);
  if (skipped.length > 0) {
    return {
      exitCode: 1,
      lines: [`ОТКАЗ: пропущено тестов: ${skipped.length}`, ...skipped.map((line) => `  ${line}`)],
    };
  }
  return { exitCode: 0, lines: [`Пропущенных тестов нет, выполнено: ${report.numTotalTests}`] };
};
