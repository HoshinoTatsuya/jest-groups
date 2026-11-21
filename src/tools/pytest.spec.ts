import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findOwnedFlags } from './find-owned-flags';
import { parsePytestCollectOutput } from './parse-pytest-collect-output';
import { PYTEST_TOOL } from './pytest.tool';
import { readPytestJunit } from './read-pytest-junit';

describe('parsePytestCollectOutput', () => {
  it('-q: запись на каждый тест — число тестов файла точное; хвост сводки не мешает', () => {
    const stdout =
      'tests/test_one.py::test_a\ntests/test_one.py::test_p[1]\ntests/test_one.py::TestK::test_m\n' +
      'tests/test_two.py::test_b\n\n4 tests collected in 0.01s\n';
    expect(parsePytestCollectOutput(stdout)).toEqual([
      'tests/test_one.py',
      'tests/test_one.py',
      'tests/test_one.py',
      'tests/test_two.py',
    ]);
  });

  it('-qq (в команде уже есть -q): «путь: N»', () => {
    expect(parsePytestCollectOutput('tests/test_one.py: 2\ntests/b.py: 1\n')).toEqual([
      'tests/test_one.py',
      'tests/test_one.py',
      'tests/b.py',
    ]);
  });

  it('тестов нет — пустая выборка; вывода той формы нет — null (отказ, а не «пусто»)', () => {
    expect(parsePytestCollectOutput('\nno tests collected in 0.01s\n')).toEqual([]);
    expect(parsePytestCollectOutput('<Module tests/test_one.py>\n  <Function test_a>\n')).toBeNull();
    // Предупреждение с одним двоеточием и номером строки — не тест.
    expect(parsePytestCollectOutput('tests/a.py:3: PytestWarning: x\n')).toBeNull();
  });
});

describe('флаги раннера в команде pytest', () => {
  const owned = (args: string[]) => findOwnedFlags(args, PYTEST_TOOL.owned);

  it.each([
    ['-n'],
    ['-n8'],
    ['-vn4'],
    ['--numprocesses=8'],
    ['--junitxml=r.xml'],
    ['--junit-xml=r.xml'],
    ['-f'],
    ['--looponfail'],
    ['--collect-only'],
    ['--co'],
  ])('%s — флаг раннера', (flag) => {
    expect(owned([flag])).toEqual([flag]);
  });

  it.each([['-v'], ['-x'], ['-k'], ['-kfn'], ['-mslow'], ['-pno:cacheprovider'], ['--maxfail=2'], ['tests']])(
    '%s — не флаг раннера (буква после флага со значением — значение)',
    (flag) => {
      expect(owned([flag])).toEqual([]);
    },
  );
});

describe('группа pytest', () => {
  it('воркеры — -n, отчёт — JUnit xunit1 с атрибутом file, файлы группы в конце', () => {
    expect(
      PYTEST_TOOL.groupArgs({
        baseArgs: ['-m', 'not slow'],
        reportPath: '/w/g.json',
        workers: 2,
        files: ['/p/t.py'],
      }),
    ).toEqual(['-m', 'not slow', '-n', '2', '-o', 'junit_family=xunit1', '--junitxml=/w/g.json', '/p/t.py']);
    expect(PYTEST_TOOL.listArgs(['-m', 'x'], 2)).toEqual(['-m', 'x', '--collect-only', '-q']);
  });
});

describe('readPytestJunit', () => {
  let dir = '';
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'pytest-junit-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const read = (xml: string) => {
    writeFileSync(join(dir, 'r.xml'), xml);
    return readPytestJunit(join(dir, 'r.xml'), '/p');
  };

  it('сьют на файл; прошёл, упал, пропущен; ошибка сбора модуля — сьют без тестов', () => {
    const result = read(
      '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest">' +
        '<testcase classname="tests.test_one" name="test_a" file="tests/test_one.py" line="2" time="0.250" />' +
        '<testcase classname="tests.test_one" name="test_b&lt;1&gt;" file="tests/test_one.py" time="0.5"><failure message="m">assert 0 &amp;&amp; x</failure></testcase>' +
        '<testcase classname="tests.test_two" name="test_s" file="tests/test_two.py" time="0"><skipped type="pytest.skip" message="later">x</skipped></testcase>' +
        '<testcase classname="" name="tests.test_bad" time="0"><error message="collection failure">ImportError</error></testcase>' +
        '</testsuite></testsuites>',
    );
    expect(result).toEqual({
      kind: 'ok',
      value: {
        numTotalTests: 3,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 1,
        numTotalTestSuites: 3,
        numFailedTestSuites: 2,
        numRuntimeErrorTestSuites: 1,
        success: false,
        testResults: [
          {
            name: '/p/tests/test_one.py',
            status: 'failed',
            message: '',
            startTime: 0,
            endTime: 750,
            assertionResults: [
              {
                status: 'passed',
                fullName: 'tests.test_one::test_a',
                title: 'test_a',
                duration: 250,
                failureMessages: [],
              },
              {
                status: 'failed',
                fullName: 'tests.test_one::test_b<1>',
                title: 'test_b<1>',
                duration: 500,
                failureMessages: ['assert 0 && x'],
              },
            ],
          },
          {
            name: '/p/tests/test_two.py',
            status: 'passed',
            message: '',
            startTime: 0,
            endTime: 0,
            assertionResults: [
              {
                status: 'skipped',
                fullName: 'tests.test_two::test_s',
                title: 'test_s',
                duration: 0,
                failureMessages: [],
              },
            ],
          },
          {
            name: '/p/tests/test_bad.py',
            status: 'failed',
            message: 'ImportError',
            startTime: 0,
            endTime: 0,
            assertionResults: [],
          },
        ],
      },
    });
  });

  it('файла нет — «не записал»; обрезан — «не JUnit XML»', () => {
    expect(readPytestJunit(join(dir, 'нет.xml'), '/p')).toEqual({ kind: 'missing' });
    expect(read('<?xml version="1.0"?><testsuites><testsuite><testcase name="a"').kind).toBe('invalid');
  });
});
