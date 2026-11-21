import { relative } from 'node:path';

import { escapeXml } from './escape-xml';
import type { JestReport } from './types/jest-report.type';

/**
 * JUnit XML из слитого отчёта. Репортёр JUnit в конфиге проекта пишет файл на
 * КАЖДЫЙ процесс jest, и при группах следующая затирала предыдущую — CI видел
 * последнюю группу. Раннер строит один файл по всем группам сам. Сьют, не
 * загрузившийся (ошибка в файле, ни одного теста), — testcase с `<error>`:
 * иначе CI показал бы его зелёным пустым сьютом.
 */
export const toJunitXml = (report: JestReport, root: string): string => {
  const SKIPPED: ReadonlySet<string> = new Set(['pending', 'skipped', 'todo', 'disabled']);
  type Assertion = {
    status: string;
    fullName: string;
    title?: string;
    ancestorTitles?: string[];
    duration?: number | null;
    failureMessages?: string[];
  };
  const seconds = (ms: unknown): string => (typeof ms === 'number' && ms > 0 ? (ms / 1000).toFixed(3) : '0');
  const suites = (report.testResults ?? []).map((suite) => {
    const extra = suite as unknown as {
      status?: string;
      message?: string;
      startTime?: number;
      endTime?: number;
      failureMessage?: string;
    };
    const tests = (suite.assertionResults ?? []) as unknown as Assertion[];
    const name = relative(root, suite.name);
    const cases = tests.map((test) => {
      const open = `    <testcase classname="${escapeXml(name)}" name="${escapeXml(test.fullName)}" time="${seconds(test.duration)}"`;
      if (test.status === 'failed') {
        const message = (test.failureMessages ?? []).join('\n');
        return `${open}>\n      <failure message="${escapeXml(message.split('\n')[0] ?? '')}">${escapeXml(message)}</failure>\n    </testcase>`;
      }
      if (SKIPPED.has(test.status)) {
        return `${open}>\n      <skipped/>\n    </testcase>`;
      }
      return `${open}/>`;
    });
    const broken = extra.status === 'failed' && tests.length === 0;
    if (broken) {
      const message = extra.message || extra.failureMessage || 'сьют не загрузился';
      cases.push(
        `    <testcase classname="${escapeXml(name)}" name="${escapeXml(name)}" time="0">\n      <error message="${escapeXml(message.split('\n')[0] ?? '')}">${escapeXml(message)}</error>\n    </testcase>`,
      );
    }
    const failures = tests.filter((test) => test.status === 'failed').length;
    const skipped = tests.filter((test) => SKIPPED.has(test.status)).length;
    const time =
      typeof extra.startTime === 'number' && typeof extra.endTime === 'number'
        ? seconds(extra.endTime - extra.startTime)
        : '0';
    return {
      tests: tests.length + (broken ? 1 : 0),
      failures,
      errors: broken ? 1 : 0,
      skipped,
      xml: `  <testsuite name="${escapeXml(name)}" tests="${tests.length + (broken ? 1 : 0)}" failures="${failures}" errors="${broken ? 1 : 0}" skipped="${skipped}" time="${time}">\n${cases.join('\n')}\n  </testsuite>`,
    };
  });
  const sum = (key: 'tests' | 'failures' | 'errors' | 'skipped'): number =>
    suites.reduce((total, suite) => total + suite[key], 0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="jest-groups" tests="${sum('tests')}" failures="${sum('failures')}" errors="${sum('errors')}" skipped="${sum('skipped')}">`,
    ...suites.map((suite) => suite.xml),
    '</testsuites>',
    '',
  ].join('\n');
};
