import { findRunFailures } from './find-run-failures';
import { findSkippedTests } from './find-skipped-tests';
import { mergeReports } from './merge-reports';
import { parseListTestsOutput } from './parse-list-tests-output';
import { readPositiveInt } from './read-positive-int';

describe('parseListTestsOutput', () => {
  it('берёт последнюю строку-массив, пропуская заголовок обёртки', () => {
    expect(parseListTestsOutput('> pnpm run test\n["/a.spec.ts","/b.spec.ts"]\n')).toEqual([
      '/a.spec.ts',
      '/b.spec.ts',
    ]);
  });

  it('массив не из строк — не выборка', () => {
    expect(parseListTestsOutput('[1,2]\n')).toBeNull();
  });

  it('нет списка — null, а не пустая выборка', () => {
    expect(parseListTestsOutput('ничего\n')).toBeNull();
  });

  it('пустой список — пустая выборка (отказ решает вызывающий)', () => {
    expect(parseListTestsOutput('[]\n')).toEqual([]);
  });

  // Сам jest печатает выборку одной строкой, но команда после `--` бывает
  // обёрткой с отступами. Построчный поиск видел в таком выводе только `[` и
  // отвечал «списка нет». Строки журнала после массива — тоже из обёрток.
  it('массив с отступами по строке на элемент (CRLF, журнал после) — выборка, а не «списка нет»', () => {
    const files = ['/a.spec.ts', '/app/[id]/b.spec.ts'];
    const stdout = `> wrapper\r\n${JSON.stringify(files, null, 2).replaceAll('\n', '\r\n')}\r\n[info] готово\r\n`;
    expect(parseListTestsOutput(stdout)).toEqual(files);
  });

  it('скобки внутри пути — не начало и не конец массива', () => {
    // `[]` в пути, сочти его началом массива, читался бы пустой выборкой.
    expect(parseListTestsOutput('["/app/[]/a.spec.ts"]\n')).toEqual(['/app/[]/a.spec.ts']);
    // Незакрытая `[` в пути, считай её скобкой, оставила бы массив незакрытым.
    expect(parseListTestsOutput('["/app/[slug/a.spec.ts"]\n')).toEqual(['/app/[slug/a.spec.ts']);
  });

  it('незакрытый массив — null', () => {
    expect(parseListTestsOutput('[\n  "/a.spec.ts",\n')).toBeNull();
  });
});

describe('mergeReports', () => {
  it('суммирует счётчики и сливает результаты сьютов', () => {
    const merged = mergeReports([
      { numTotalTests: 3, numFailedTests: 0, success: true, startTime: 20, testResults: [{ name: 'a' }] },
      { numTotalTests: 4, numFailedTests: 1, success: false, startTime: 10, testResults: [{ name: 'b' }] },
    ]);
    expect(merged.numTotalTests).toBe(7);
    expect(merged.numFailedTests).toBe(1);
    expect(merged.success).toBe(false);
    expect(merged.startTime).toBe(10);
    expect(merged.testResults?.map((suite) => suite.name)).toEqual(['a', 'b']);
  });

  it('успех — только если успешны все группы', () => {
    expect(mergeReports([{ success: true }, { success: true }]).success).toBe(true);
    expect(mergeReports([{ success: true }, {}]).success).toBe(false);
  });

  it('пустой список отчётов — исключение, а не «успех»', () => {
    expect(() => mergeReports([])).toThrow('нет ни одного отчёта');
  });
});

describe('findSkippedTests', () => {
  it('находит pending, skipped, todo и disabled и не трогает passed/failed', () => {
    const skipped = findSkippedTests({
      testResults: [
        {
          name: 'a.spec.ts',
          assertionResults: [
            { status: 'passed', fullName: 'ok' },
            { status: 'failed', fullName: 'red' },
            { status: 'pending', fullName: 'p' },
            { status: 'skipped', fullName: 's' },
            { status: 'todo', fullName: 't' },
            { status: 'disabled', fullName: 'd' },
            // `fit`: тест выполнялся — не пропуск (пропущенные им соседи приходят как pending).
            { status: 'focused', fullName: 'f' },
          ],
        },
      ],
    });
    expect(skipped).toEqual(['a.spec.ts: p', 'a.spec.ts: s', 'a.spec.ts: t', 'a.spec.ts: d']);
  });
});

describe('readPositiveInt', () => {
  it('пусто — значение по умолчанию', () => {
    expect(readPositiveInt(undefined, 300, 'X')).toBe(300);
    expect(readPositiveInt('', 300, 'X')).toBe(300);
  });

  it('целое больше нуля — как есть', () => {
    expect(readPositiveInt('150', 300, 'X')).toBe(150);
  });

  it.each(['0', '-1', '1.5', 'abc'])('«%s» — исключение, а не тихий откат', (raw) => {
    expect(() => readPositiveInt(raw, 300, 'X')).toThrow('X');
  });
});

describe('findRunFailures', () => {
  const ok = {
    success: true,
    numTotalTests: 2,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numRuntimeErrorTestSuites: 0,
    testResults: [
      { name: '/a.spec.ts', status: 'passed', assertionResults: [{ status: 'passed', fullName: 'a' }] },
    ],
  };

  it('успешный отчёт — причин нет (контроль)', () => {
    expect(findRunFailures(ok)).toEqual([]);
  });

  it('сьют не загрузился (синтаксическая ошибка): ни одного теста, пропусков нет — отказ', () => {
    const report = {
      ...ok,
      success: false,
      numFailedTestSuites: 1,
      numRuntimeErrorTestSuites: 1,
      testResults: [{ name: '/broken.spec.ts', status: 'failed', assertionResults: [] }],
    };

    expect(findRunFailures(report)).toEqual(
      expect.arrayContaining(['/broken.spec.ts: сьют не загрузился — ни одного теста']),
    );
  });

  it('упавшие тесты — отказ, даже если success ошибочно true', () => {
    expect(findRunFailures({ ...ok, numFailedTests: 1 })).toEqual(['упало тестов: 1']);
  });

  /**
   * Каждый признак — отдельно, при success: true: проверка, ставившая сразу
   * несколько, была зелёной без любого одного из них (рубежи маскировали друг
   * друга).
   */
  it.each([
    ['numFailedTestSuites', 'упало сьютов: 1'],
    ['numRuntimeErrorTestSuites', 'сьютов с ошибкой выполнения: 1'],
  ])('%s > 0 — отказ сам по себе, даже если success ошибочно true', (field, reason) => {
    expect(findRunFailures({ ...ok, [field]: 1 })).toEqual([reason]);
  });

  it('нет testResults — отказ', () => {
    const { testResults: _dropped, ...withoutResults } = ok;
    expect(findRunFailures(withoutResults)).toEqual([
      'в отчёте нет списка сьютов (testResults) — что выполнялось, не определить',
    ]);
  });

  it('success не true — отказ', () => {
    expect(findRunFailures({ ...ok, success: false })).toEqual(['отчёт не успешен (success: false)']);
  });
});
