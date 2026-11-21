import { mergeSnapshotSummaries } from './merge-snapshot-summaries';
import type { JestReport } from './types/jest-report.type';

type CounterKey =
  | 'numTotalTests'
  | 'numPassedTests'
  | 'numFailedTests'
  | 'numPendingTests'
  | 'numTodoTests'
  | 'numTotalTestSuites'
  | 'numPassedTestSuites'
  | 'numFailedTestSuites'
  | 'numPendingTestSuites'
  | 'numRuntimeErrorTestSuites';

const COUNTERS: readonly CounterKey[] = [
  'numTotalTests',
  'numPassedTests',
  'numFailedTests',
  'numPendingTests',
  'numTodoTests',
  'numTotalTestSuites',
  'numPassedTestSuites',
  'numFailedTestSuites',
  'numPendingTestSuites',
  'numRuntimeErrorTestSuites',
];

/**
 * Слияние отчётов групп в форму одного `jest --json`: его читают проверки
 * после прогона (assert-no-skipped). Пустой список — отказ вызывающего, а не
 * «успешный пустой отчёт»: `[].every()` вернул бы success=true. Итог снимков
 * и открытые дескрипторы — со ВСЕХ групп (прежде — первой).
 */
export const mergeReports = (reports: readonly JestReport[]): JestReport => {
  const [first] = reports;
  if (first === undefined) {
    throw new Error('mergeReports: нет ни одного отчёта группы');
  }
  const counters = Object.fromEntries(
    COUNTERS.map((key) => [key, reports.reduce((total, report) => total + (report[key] ?? 0), 0)]),
  ) as Record<CounterKey, number>;
  const snapshot = mergeSnapshotSummaries(
    reports.flatMap((report) =>
      typeof report.snapshot === 'object' && report.snapshot !== null
        ? [report.snapshot as Record<string, unknown>]
        : [],
    ),
  );
  const openHandles = reports.flatMap((report) =>
    Array.isArray(report.openHandles) ? (report.openHandles as unknown[]) : [],
  );
  return {
    ...first,
    ...counters,
    ...(snapshot === undefined ? {} : { snapshot }),
    openHandles,
    wasInterrupted: reports.some((report) => report.wasInterrupted === true),
    startTime: Math.min(...reports.map((report) => report.startTime ?? 0)),
    success: reports.every((report) => report.success === true),
    testResults: reports.flatMap((report) => report.testResults ?? []),
  };
};
