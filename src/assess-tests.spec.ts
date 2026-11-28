import * as ts from 'typescript';

import { assessTests } from './assess-tests';

const assess = (text: string): { tests: number; certain: boolean } => assessTests(ts, 'x.spec.ts', text);

describe('assessTests: доказана ли оценка текстом', () => {
  it.each([
    ['видимые вызовы', "it('a', f); test('b', f);", 2],
    ['таблица-литерал', "it.each([[1], [2], [3]])('%s', f);", 3],
    ['таблица-константа файла', "const CASES = [1, 2, 3, 4];\nit.each(CASES)('%s', f);", 4],
    ['цикл без тестов внутри не мешает', "for (;;) { break; }\nit('a', f);", 1],
  ])('%s — доказана', (_case, text, tests) => {
    expect(assess(text)).toEqual({ tests, certain: true });
  });

  it.each([
    ['таблица из импорта', "it.each(IMPORTED)('%s', f);", 5],
    ['тест в for (;;)', "for (let i = 0; i < n; i++) { it('t', f); }", 5],
    ['тест в while', "while (more()) { it('t', f); }", 5],
    ['describe.each по неизвестной таблице', "describe.each(rows)('%s', () => { it('a', f); });", 5],
    ['ни одного видимого вызова', 'rules.all(config);', 1],
  ])('%s — не доказана', (_case, text, tests) => {
    expect(assess(text)).toEqual({ tests, certain: false });
  });

  it('без TypeScript: вызовы есть и нет .each — доказана; иначе нет', () => {
    expect(assessTests(null, 'x.spec.ts', "it('a', f); it('b', f);")).toEqual({ tests: 2, certain: true });
    expect(assessTests(null, 'x.spec.ts', "it.each(rows)('a', f);")).toEqual({ tests: 1, certain: false });
    expect(assessTests(null, 'x.spec.ts', 'rules.all(config);')).toEqual({ tests: 1, certain: false });
  });

  // Цикл регулярка не разворачивает: «доказанный» 1 тест у файла на 7 выталкивал группу за потолок.
  it.each([
    ['for..of', "for (const n of cases()) it('t' + n, f);"],
    ['for await', "for await (const n of rows()) it('t', f);"],
    ['for (;;)', "for (let i = 0; i < n; i++) { it('t', f); }"],
    ['while', "while (more()) { it('t', f); }"],
    ['forEach', 'rows.forEach((row) => it(row, f));'],
    ['map', 'rows.map((row) => it(row, f));'],
    ['flatMap', 'rows.flatMap((row) => [it(row, f)]);'],
  ])('без TypeScript: тест в цикле (%s) — не доказана', (_case, text) => {
    expect(assessTests(null, 'x.spec.ts', text)).toEqual({ tests: 1, certain: false });
  });

  it.each([
    ['map внутри expect', "it('a', () => expect([1].map(f)).toEqual([2]));"],
    ['forEach в теле теста', "it('a', () => { rows.forEach((row) => check(row)); });"],
    ['for в теле теста', "it('a', () => { for (const row of rows) check(row); });"],
    ['цикл до теста без вызова теста', "for (;;) { break; }\nit('a', f);"],
    ['скобки в строке', "it('a ) ( ] [', () => rows.map(f));"],
  ])('без TypeScript: цикл без вызова теста внутри (%s) — доказана', (_case, text) => {
    expect(assessTests(null, 'x.spec.ts', text)).toEqual({ tests: 1, certain: true });
  });

  it.each([
    ['do-while', "do { it('t', f); } while (more());"],
    ['for без скобок, вызов теста — оператор', "for (const n of xs)\n  it('t' + n, f);"],
    ['map с describe и it внутри', "rows.map((row) => describe(row, () => { it('t', f); }));"],
  ])('без TypeScript: цикл с вызовом теста внутри (%s) — не доказана', (_case, text) => {
    expect(assessTests(null, 'x.spec.ts', text).certain).toBe(false);
  });

  it('без TypeScript: слова, похожие на цикл, — не цикл (информация, platform, formatted)', () => {
    expect(
      assessTests(null, 'x.spec.ts', "const info = format(platform);\nit('a', f);\nit('b', f);"),
    ).toEqual({ tests: 2, certain: true });
  });
});
