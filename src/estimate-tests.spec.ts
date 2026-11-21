import * as ts from 'typescript';

import { estimateTests } from './estimate-tests';

const estimate = (text: string): number => estimateTests(ts, 'x.spec.ts', text);

describe('estimateTests', () => {
  it('считает it и test внутри describe', () => {
    expect(
      estimate(`describe('a', () => { it('1', () => {}); test('2', () => {}); it.skip('3', () => {}); });`),
    ).toBe(3);
  });

  it('it.each с литеральной таблицей — по числу строк', () => {
    expect(estimate(`it.each([[1], [2], [3], [4]])('%s', () => {});`)).toBe(4);
  });

  it('describe.each умножает вложенные тесты', () => {
    expect(estimate(`describe.each([1, 2])('%s', () => { it('a', () => {}); it('b', () => {}); });`)).toBe(4);
  });

  it('шаблонная таблица it.each`...` — строки без заголовка', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: это текст спеки с шаблонной таблицей
    const text = "it.each`\n  a | b\n  ${1} | ${2}\n  ${3} | ${4}\n`('x', () => {});";
    expect(estimate(text)).toBe(2);
  });

  it('цикл for..of по литералу умножает тело', () => {
    expect(estimate(`for (const x of [1, 2, 3]) { it('t' + x, () => {}); }`)).toBe(3);
  });

  it('таблица из переменной — оценка, а не единица', () => {
    expect(estimate(`it.each(CASES)('%s', () => {});`)).toBe(5);
  });

  it('файл без тестов стоит запуска — не меньше одного', () => {
    expect(estimate('export const x = 1;')).toBe(1);
  });

  it('без TypeScript — подсчёт вызовов регуляркой', () => {
    expect(estimateTests(null, 'x.spec.ts', `it('a', f); test.only('b', f); describe('c', f);`)).toBe(2);
  });
});

describe('estimateTests: пробелы мутаций', () => {
  it.each([
    ['for (let i = 0; i < 3; i++) { it("t", () => {}); }', 5],
    ['for (const k in table) { it(k, () => {}); }', 5],
    ['while (more()) { it("t", () => {}); }', 5],
    ['[1, 2, 3].forEach((n) => it("t" + n, () => {}));', 3],
    ['[1, 2].map((n) => it("t" + n, () => {}));', 2],
    ['rows.forEach((n) => it("t" + n, () => {}));', 5],
  ])('цикл %s → %i', (text, expected) => {
    expect(estimate(text)).toBe(expected);
  });

  it('.each у НЕ тестовой функции — не тест: считаются только тесты внутри', () => {
    expect(estimate(`table.each([1, 2])('x', () => { it('a', () => {}); });`)).toBe(1);
  });

  it('it.each() без таблицы — оценка повторов, а не отказ', () => {
    expect(estimate(`it.each()('x', () => {});`)).toBe(5);
  });

  it('шаблонная таблица с несколькими колонками — по строкам, а не по разделителям', () => {
    expect(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: это текст спеки с шаблонной таблицей
      estimate("it.each`\n  a | b | c\n  ${1} | ${2} | ${3}\n  ${4} | ${5} | ${6}\n`('x', () => {});"),
    ).toBe(2);
  });

  it('describe.each по шаблонной таблице умножает вложенные тесты один раз', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: это текст спеки с шаблонной таблицей
    expect(estimate("describe.each`\n  a\n  ${1}\n  ${2}\n`('x', () => { it('t', () => {}); });")).toBe(2);
  });

  it('без TypeScript: только вызовы it/test, не describe', () => {
    expect(estimateTests(null, 'x.spec.ts', `describe('a', () => {});`)).toBe(1);
    expect(estimateTests(null, 'x.spec.ts', `it('a', f); it('b', f); it('c', f);`)).toBe(3);
  });
});

describe('estimateTests: таблица из константы того же файла — по её строкам', () => {
  it.each([
    [
      'const с аннотацией типа',
      'const CASES: ReadonlyArray<readonly [number]> = [[1], [2], [3], [4], [5], [6], [7]];\nit.each(CASES)("%s", f);',
      7,
    ],
    [
      'as const и satisfies',
      'const CASES = [[1], [2], [3], [4], [5], [6]] as const satisfies readonly unknown[];\nit.each(CASES)("%s", f);',
      6,
    ],
    [
      'describe.each по константе умножает вложенные',
      'const ROWS = [1, 2, 3, 4, 5, 6];\ndescribe.each(ROWS)("%s", () => { it("a", f); it("b", f); });',
      12,
    ],
    [
      'map константы — та же длина',
      'const ROWS = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }];\nit.each(ROWS.map((row) => [row.n]))("%s", f);',
      6,
    ],
    [
      'for..of по константе',
      'const ROWS = [1, 2, 3, 4, 5, 6, 7, 8];\nfor (const row of ROWS) { it(String(row), f); }',
      8,
    ],
    [
      'forEach константы',
      'const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];\nROWS.forEach((row) => it(String(row), f));',
      9,
    ],
    [
      'распаковка другой константы',
      'const A = [1, 2, 3, 4];\nconst B = [...A, 5, 6, 7];\nit.each(B)("%s", f);',
      7,
    ],
    [
      'Object.entries объекта-константы',
      'const BY_NAME = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };\nit.each(Object.entries(BY_NAME))("%s", f);',
      6,
    ],
  ])('%s', (_case, text, expected) => {
    expect(estimate(text)).toBe(expected);
  });

  it.each([
    [
      'let — может быть переписана',
      'let CASES = [[1], [2], [3], [4], [5], [6], [7]];\nit.each(CASES)("%s", f);',
    ],
    [
      'имя объявлено дважды (тень)',
      'const CASES = [1, 2, 3, 4, 5, 6, 7];\nfunction g() { const CASES = [1]; return CASES; }\nit.each(CASES)("%s", f);',
    ],
    ['filter меняет длину', 'const ROWS = [1, 2, 3, 4, 5, 6, 7];\nit.each(ROWS.filter(Boolean))("%s", f);'],
    ['распаковка неизвестного', 'const B = [...imported, 1, 2];\nit.each(B)("%s", f);'],
  ])('не доказуемо (%s) — оценка повторов, а не длина литерала', (_case, text) => {
    expect(estimate(text)).toBe(5);
  });
});
