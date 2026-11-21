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
});
