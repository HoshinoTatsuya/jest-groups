import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JSON_FILE_READ } from '../constants/json-file-read.constant';
import type { JestReport } from '../types/jest-report.type';
import type { JsonFileRead } from '../types/json-file-read.type';

/**
 * Отчёт группы pytest (JUnit XML, `junit_family=xunit1` — с атрибутом `file`)
 * в форме `jest --json`: сьют на файл, тест — `passed`/`failed`/`skipped`.
 * Так дальше работают общие проверки раннера и `jest-assert-no-skipped`:
 * xfail pytest пишет пропуском — и это пропуск (непроверенное). Тест без
 * `file` (ошибка сбора модуля) — сьют, упавший без тестов: «не загрузился».
 */
export const readPytestJunit = (path: string, root: string): JsonFileRead<JestReport> => {
  let xml: string;
  try {
    xml = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: JSON_FILE_READ.missing };
    }
    return { kind: JSON_FILE_READ.invalid, reason: `не прочитан: ${String(error)}` };
  }
  if (!/<\/testsuites>\s*$/.test(xml) && !/<\/testsuite>\s*$/.test(xml)) {
    return { kind: JSON_FILE_READ.invalid, reason: `не JUnit XML — обрезан? (${xml.length} байт)` };
  }
  const decodeXml = (text: string): string =>
    text
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replaceAll('&amp;', '&');
  const attribute = (tag: string, name: string): string | undefined => {
    const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
    return value === undefined ? undefined : decodeXml(value);
  };
  type Assertion = {
    status: string;
    fullName: string;
    title: string;
    duration: number;
    failureMessages: string[];
  };
  const suites = new Map<string, { assertions: Assertion[]; broken: string | null; ms: number }>();
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const tag = match[1] ?? '';
    const body = match[2] ?? '';
    const file = attribute(tag, 'file');
    const name = attribute(tag, 'name') ?? '';
    const ms = Math.round(Number(attribute(tag, 'time') ?? '0') * 1000);
    const failed = /<(?:failure|error)\b/.test(body);
    const message = decodeXml(
      /<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(body)?.[1] ?? '',
    );
    if (file === undefined) {
      const modulePath = resolve(root, `${name.replaceAll('.', '/')}.py`);
      const suite = suites.get(modulePath) ?? { assertions: [], broken: null, ms: 0 };
      suites.set(modulePath, { ...suite, broken: message || 'ошибка сбора модуля' });
      continue;
    }
    const key = resolve(root, file);
    const suite = suites.get(key) ?? { assertions: [], broken: null, ms: 0 };
    suite.ms += ms;
    suite.assertions.push({
      status: failed ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed',
      fullName: `${attribute(tag, 'classname') ?? ''}::${name}`,
      title: name,
      duration: ms,
      failureMessages: failed ? [message] : [],
    });
    suites.set(key, suite);
  }
  const testResults = [...suites.entries()].map(([name, suite]) => ({
    name,
    status:
      suite.broken !== null || suite.assertions.some((test) => test.status === 'failed')
        ? 'failed'
        : 'passed',
    message: suite.broken ?? '',
    startTime: 0,
    endTime: suite.ms,
    assertionResults: suite.assertions,
  }));
  const tests = testResults.flatMap((suite) => suite.assertionResults);
  const count = (status: string): number => tests.filter((test) => test.status === status).length;
  const broken = testResults.filter((suite) => suite.message !== '').length;
  const report: JestReport = {
    numTotalTests: tests.length,
    numPassedTests: count('passed'),
    numFailedTests: count('failed'),
    numPendingTests: count('skipped'),
    numTotalTestSuites: testResults.length,
    numFailedTestSuites: testResults.filter((suite) => suite.status === 'failed').length,
    numRuntimeErrorTestSuites: broken,
    success: count('failed') === 0 && broken === 0,
    testResults,
  };
  return { kind: JSON_FILE_READ.ok, value: report };
};
