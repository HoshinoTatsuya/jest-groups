import type { JestReport } from './types/jest-report.type';

/**
 * Почему отчёт jest — не «всё прошло»: упавшие тесты, упавшие сьюты (ошибка
 * загрузки файла даёт сьют без единого теста — пропусков в нём нет, и проверка
 * одних пропусков сочла бы его чистым), отчёт без списка сьютов. Пустой ответ —
 * отчёт чистый.
 *
 * Внешний аудит 13.11.2026: `jest-assert-no-skipped` смотрел только пропуски и
 * возвращал 0 на отчёте с упавшими сьютами. В цепочках `jest-groups &&` до него
 * дело не доходило (раннер падает раньше), но отдельный вызов был ложно-зелёным.
 */
export const findRunFailures = (report: JestReport): string[] => {
  const reasons: string[] = [];
  if (!Array.isArray(report.testResults)) {
    reasons.push('в отчёте нет списка сьютов (testResults) — что выполнялось, не определить');
  }
  if (report.success !== true) {
    reasons.push(`отчёт не успешен (success: ${JSON.stringify(report.success)})`);
  }
  if ((report.numFailedTests ?? 0) > 0) {
    reasons.push(`упало тестов: ${report.numFailedTests}`);
  }
  if ((report.numFailedTestSuites ?? 0) > 0) {
    reasons.push(`упало сьютов: ${report.numFailedTestSuites}`);
  }
  if ((report.numRuntimeErrorTestSuites ?? 0) > 0) {
    reasons.push(`сьютов с ошибкой выполнения: ${report.numRuntimeErrorTestSuites}`);
  }
  for (const suite of report.testResults ?? []) {
    const status = (suite as { status?: unknown }).status;
    if (status === 'failed' && (suite.assertionResults ?? []).length === 0) {
      reasons.push(`${suite.name}: сьют не загрузился — ни одного теста`);
    }
  }
  return reasons;
};
