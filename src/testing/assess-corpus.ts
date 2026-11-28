import type { TestAssessment } from '../types/test-assessment.type';

/**
 * Фикстуры оценки по тексту для сверки путей: AST (любой JS API TypeScript —
 * 5.9, 6.x, `@typescript/typescript6`) и регулярки (TypeScript нет или у него
 * нет API, а typescript6 не установлен). У каждой фикстуры ожидания ОБОИХ
 * путей; где они расходятся, это различие и есть документ (README, «Оценка
 * без TypeScript»).
 */
export const ASSESS_CORPUS: ReadonlyArray<
  readonly [name: string, text: string, ast: TestAssessment, regex: TestAssessment]
> = [
  ['видимые вызовы', "it('a', f); test('b', f);", { tests: 2, certain: true }, { tests: 2, certain: true }],
  [
    'describe с it, test и it.skip',
    "describe('a', () => { it('1', () => {}); test('2', () => {}); it.skip('3', () => {}); });",
    { tests: 3, certain: true },
    { tests: 3, certain: true },
  ],
  [
    'xit, fit, xtest',
    "xit('a', f); fit('b', f); xtest('c', f);",
    { tests: 3, certain: true },
    { tests: 3, certain: true },
  ],
  [
    'таблица-литерал it.each',
    "it.each([[1], [2], [3]])('%s', f);",
    { tests: 3, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'таблица-константа файла',
    "const CASES = [1, 2, 3, 4];\nit.each(CASES)('%s', f);",
    { tests: 4, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'describe.each умножает вложенные',
    "describe.each([1, 2])('%s', () => { it('a', () => {}); it('b', () => {}); });",
    { tests: 4, certain: true },
    { tests: 2, certain: false },
  ],
  [
    'шаблонная таблица it.each`…`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: это текст спеки с шаблонной таблицей
    "it.each`\n  a | b\n  ${1} | ${2}\n  ${3} | ${4}\n`('x', () => {});",
    { tests: 2, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'for..of по литералу',
    "for (const x of [1, 2, 3]) { it('t' + x, () => {}); }",
    { tests: 3, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'forEach литерала',
    "[1, 2, 3].forEach((n) => it('t' + n, () => {}));",
    { tests: 3, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'тест в for (;;)',
    "for (let i = 0; i < n; i++) { it('t', f); }",
    { tests: 5, certain: false },
    { tests: 1, certain: false },
  ],
  [
    'тест в while',
    "while (more()) { it('t', f); }",
    { tests: 5, certain: false },
    { tests: 1, certain: false },
  ],
  [
    'таблица из импорта',
    "it.each(IMPORTED)('%s', f);",
    { tests: 5, certain: false },
    { tests: 1, certain: false },
  ],
  [
    'ни одного видимого вызова',
    'rules.all(config);',
    { tests: 1, certain: false },
    { tests: 1, certain: false },
  ],
  [
    'цикл без тестов внутри',
    "for (;;) { break; }\nit('a', f);",
    { tests: 1, certain: true },
    { tests: 1, certain: true },
  ],
  [
    'вызов в комментарии',
    "// it('старый', f);\nit('a', f);",
    { tests: 1, certain: true },
    { tests: 2, certain: true },
  ],
  [
    'describe.each по константе',
    "const ROWS = [1, 2, 3, 4, 5, 6];\ndescribe.each(ROWS)('%s', () => { it('a', f); it('b', f); });",
    { tests: 12, certain: true },
    { tests: 2, certain: false },
  ],
  [
    'let — может быть переписана',
    "let CASES = [[1], [2]];\nit.each(CASES)('%s', f);",
    { tests: 5, certain: false },
    { tests: 1, certain: false },
  ],
  [
    'Object.entries объекта-константы',
    "const BY_NAME = { a: 1, b: 2, c: 3 };\nit.each(Object.entries(BY_NAME))('%s', f);",
    { tests: 3, certain: true },
    { tests: 1, certain: false },
  ],
  [
    '.each у не тестовой функции',
    "table.each([1, 2])('x', () => { it('a', () => {}); });",
    { tests: 1, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'распаковка другой константы',
    "const A = [1, 2, 3, 4];\nconst B = [...A, 5, 6, 7];\nit.each(B)('%s', f);",
    { tests: 7, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'describe.each × it.each',
    "describe.each([1, 2])('%s', () => { it.each([[1], [2], [3]])('%s', f); });",
    { tests: 6, certain: true },
    { tests: 1, certain: false },
  ],
  [
    'as const и satisfies',
    "const CASES = [[1], [2], [3], [4], [5], [6]] as const satisfies readonly unknown[];\nit.each(CASES)('%s', f);",
    { tests: 6, certain: true },
    { tests: 1, certain: false },
  ],
];
