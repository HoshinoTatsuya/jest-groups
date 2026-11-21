import type { JestReport } from './types/jest-report.type';

/**
 * Статусы пропуска. Тип статуса Jest 30 (`Status` в @jest/types, им же
 * типизирован `AssertionResult.status` в @jest/test-result) — `passed | failed |
 * skipped | pending | todo | disabled | focused`. jest-circus (раннер по
 * умолчанию) отдаёт из них четыре: `it.skip`, `xit` и тесты `describe.skip` —
 * `pending`, `test.todo` — `todo`, остальное — `passed`/`failed`
 * (jestAdapterInit.js, разбор результата теста). `skipped` и `disabled` в типе
 * есть, и circus их не отдаёт — но отчёт пишет не только он: `testRunner`
 * проекта бывает другим (jest-jasmine2, сторонний), и статус из общего типа —
 * его законный ответ. Снять их значило бы пропустить пропуск такого раннера
 * молча; лишний статус в множестве не стоит ничего.
 * `focused` — тест, который выполнялся (`fit`), не пропуск: пропущенные им
 * соседи приходят как `pending`.
 */
const SKIPPED_STATUSES: ReadonlySet<string> = new Set(['pending', 'skipped', 'todo', 'disabled']);

/**
 * Пропущенные тесты отчёта в виде «файл: имя». Проверки на коммите задают все
 * адреса хранилищ, поэтому пропуск там — непроверенное, а не «не настроено».
 */
export const findSkippedTests = (report: JestReport): string[] =>
  (report.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((test) => SKIPPED_STATUSES.has(test.status))
      .map((test) => `${suite.name}: ${test.fullName}`),
  );
