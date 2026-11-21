import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkReportFile } from './check-report-file';
import { escapeXml } from './escape-xml';
import { findRunFailures } from './find-run-failures';
import { mergeReports } from './merge-reports';
import { mergeSnapshotSummaries } from './merge-snapshot-summaries';
import { parseListTestsOutput } from './parse-list-tests-output';
import { toJunitXml } from './to-junit-xml';

describe('mergeReports: снимки и открытые дескрипторы — со всех групп', () => {
  const snapshot = (over: Record<string, unknown>) => ({
    added: 0,
    didUpdate: false,
    failure: false,
    filesAdded: 0,
    filesRemoved: 0,
    filesRemovedList: [] as string[],
    filesUnmatched: 0,
    filesUpdated: 0,
    matched: 0,
    total: 0,
    unchecked: 0,
    uncheckedKeysByFile: [] as unknown[],
    unmatched: 0,
    updated: 0,
    ...over,
  });

  it('счётчики — суммой, failure — если хоть одна группа, непроверенные ключи — списком', () => {
    const merged = mergeReports([
      { success: true, snapshot: snapshot({ matched: 3, total: 3 }), openHandles: [] },
      {
        success: false,
        snapshot: snapshot({
          matched: 1,
          unchecked: 2,
          total: 3,
          failure: true,
          uncheckedKeysByFile: [{ filePath: 'b', keys: ['k'] }],
        }),
        openHandles: [{ message: 'TCPSERVERWRAP' }],
      },
    ]);
    expect(merged.snapshot).toEqual(
      snapshot({
        matched: 4,
        unchecked: 2,
        total: 6,
        failure: true,
        uncheckedKeysByFile: [{ filePath: 'b', keys: ['k'] }],
      }),
    );
    expect(merged.openHandles).toEqual([{ message: 'TCPSERVERWRAP' }]);
  });

  it('устаревшие файлы снимков jest находит в КАЖДОЙ группе — объединение, а не сумма', () => {
    const orphan = snapshot({
      filesRemoved: 1,
      filesRemovedList: ['/p/__snapshots__/gone.spec.ts.snap'],
      failure: true,
    });
    const merged = mergeSnapshotSummaries([orphan, orphan, orphan]);
    expect(merged?.filesRemoved).toBe(1);
    expect(merged?.filesRemovedList).toEqual(['/p/__snapshots__/gone.spec.ts.snap']);
  });

  it('у групп без снимков (не jest) — поля нет; прерванная группа — wasInterrupted', () => {
    const merged = mergeReports([{ success: true }, { success: true, wasInterrupted: true }]);
    expect(merged.snapshot).toBeUndefined();
    expect(merged.wasInterrupted).toBe(true);
    expect(mergeReports([{ success: true }]).wasInterrupted).toBe(false);
  });
});

describe('toJunitXml', () => {
  it('сьюты, падения, пропуски, неподгрузившийся сьют — ошибкой; управляющие символы сняты', () => {
    const xml = toJunitXml(
      {
        testResults: [
          {
            name: '/p/src/a.spec.ts',
            startTime: 1000,
            endTime: 1500,
            assertionResults: [
              { status: 'passed', fullName: 'a ok', duration: 12 },
              {
                status: 'failed',
                fullName: 'a <red>',
                failureMessages: ['\u001b[31mexpected 1\u001b[39m\nstack'],
              },
              { status: 'pending', fullName: 'a skip' },
            ],
          },
          {
            name: '/p/src/broken.spec.ts',
            status: 'failed',
            message: 'SyntaxError: x',
            assertionResults: [],
          },
        ],
      } as never,
      '/p',
    );
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<testsuites name="jest-groups" tests="4" failures="1" errors="1" skipped="1">',
        '  <testsuite name="src/a.spec.ts" tests="3" failures="1" errors="0" skipped="1" time="0.500">',
        '    <testcase classname="src/a.spec.ts" name="a ok" time="0.012"/>',
        '    <testcase classname="src/a.spec.ts" name="a &lt;red&gt;" time="0">',
        '      <failure message="expected 1">expected 1\nstack</failure>',
        '    </testcase>',
        '    <testcase classname="src/a.spec.ts" name="a skip" time="0">',
        '      <skipped/>',
        '    </testcase>',
        '  </testsuite>',
        '  <testsuite name="src/broken.spec.ts" tests="1" failures="0" errors="1" skipped="0" time="0">',
        '    <testcase classname="src/broken.spec.ts" name="src/broken.spec.ts" time="0">',
        '      <error message="SyntaxError: x">SyntaxError: x</error>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
        '',
      ].join('\n'),
    );
  });

  it('escapeXml: пять сущностей и недопустимые в XML символы', () => {
    expect(escapeXml(`<a href="x">'&'</a>\u0007`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });
});

describe('checkReportFile (jest-assert-no-skipped)', () => {
  let dir = '';
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-check-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const check = (report: unknown, allowPartial = false) => {
    writeFileSync(join(dir, 'r.json'), JSON.stringify(report));
    return checkReportFile(join(dir, 'r.json'), allowPartial);
  };
  const green = {
    success: true,
    numTotalTests: 1,
    testResults: [{ name: 'a', assertionResults: [{ status: 'passed', fullName: 'x' }] }],
  };

  it('чистый отчёт — 0', () => {
    expect(check(green).exitCode).toBe(0);
  });

  it('частичный отчёт без --allow-partial — отказ; с ним — проверка как обычно', () => {
    const partial = { ...green, jestGroups: { tool: 'jest', groups: 1, partial: 'changed-since main' } };
    expect(check(partial)).toEqual({
      exitCode: 1,
      lines: [
        'ОТКАЗ: отчёт частичный (changed-since main) — он не покрывает весь набор; для быстрого прогона задайте --allow-partial явно',
      ],
    });
    expect(check(partial, true).exitCode).toBe(0);
  });

  it('пустой частичный («изменённых нет») с --allow-partial — 0; пустой полный — отказ', () => {
    const empty = { success: true, numTotalTests: 0, testResults: [] };
    expect(
      check({ ...empty, jestGroups: { tool: 'jest', groups: 0, partial: 'changed-since HEAD' } }, true)
        .exitCode,
    ).toBe(0);
    expect(check(empty, true).exitCode).toBe(1);
  });

  it('шард — не частичный отчёт: проверяется без --allow-partial', () => {
    expect(check({ ...green, jestGroups: { tool: 'jest', groups: 1, shard: '1/2' } }).exitCode).toBe(0);
  });
});

describe('пробелы мутаций: разбор выборки', () => {
  it('из двух массивов строк — ПОСЛЕДНИЙ (первый — эхо обёртки)', () => {
    expect(parseListTestsOutput('noise\n["/old.spec.ts"]\n["/a.spec.ts","/b.spec.ts"]\n')).toEqual([
      '/a.spec.ts',
      '/b.spec.ts',
    ]);
  });

  it('экранированная кавычка в пути не закрывает строку раньше времени', () => {
    expect(parseListTestsOutput('["/app/x\\"]/a.spec.ts"]\n')).toEqual(['/app/x"]/a.spec.ts']);
  });

  it('незакрытый последний массив — берётся предыдущий целый', () => {
    expect(parseListTestsOutput('["/a.spec.ts"]\n[\n  "/b.spec.ts",\n')).toEqual(['/a.spec.ts']);
  });
});

describe('пробелы мутаций: findRunFailures, «сьют не загрузился»', () => {
  it('упавший сьют С тестами — не «не загрузился» (это упавшие тесты)', () => {
    const reasons = findRunFailures({
      success: false,
      numFailedTests: 1,
      testResults: [
        { name: 'a', status: 'failed', assertionResults: [{ status: 'failed', fullName: 'x' }] } as never,
      ],
    });
    expect(reasons).toEqual(['отчёт не успешен (success: false)', 'упало тестов: 1']);
  });

  it('успешный сьют без тестов — не «не загрузился»', () => {
    expect(
      findRunFailures({
        success: true,
        testResults: [{ name: 'a', status: 'passed', assertionResults: [] } as never],
      }),
    ).toEqual([]);
  });

  it('упавший сьют без тестов — «не загрузился»', () => {
    expect(
      findRunFailures({
        success: true,
        testResults: [{ name: 'a', status: 'failed', assertionResults: [] } as never],
      }),
    ).toEqual(['a: сьют не загрузился — ни одного теста']);
  });
});
