import type * as Ts from 'typescript';

import { GROUP_DEFAULTS } from './constants/group-defaults.constant';
import { TYPESCRIPT_API_MEMBERS } from './constants/typescript-api-members.constant';
import { isTypescriptApi } from './is-typescript-api';
import { JestGroupsError } from './jest-groups.error';
import type { TestAssessment } from './types/test-assessment.type';
import type { TypescriptApi } from './types/typescript-api.type';

const TEST_CALLEES: ReadonlySet<string> = new Set(['it', 'test', 'xit', 'fit', 'xtest']);
const ITERATING_METHODS: ReadonlySet<string> = new Set(['forEach', 'map', 'flatMap']);
// Те же имена, что TEST_CALLEES: прежде xit/fit/xtest регулярка не видела вовсе.
const FALLBACK_TEST_CALL = /\b(?:[xf]?it|x?test)(?:\.\w+)*\s*\(/g;
const FALLBACK_UNKNOWN_REPEAT = /\.each\b/;

/**
 * Оценка числа тестов файла по тексту и то, доказана ли она текстом.
 *
 * Таблица `.each`, `for..of` и `forEach`/`map` считаются по длине литерала —
 * и литерала КОНСТАНТЫ того же файла (`const CASES = [...]`, с `as const`,
 * `satisfies`, распаковкой других таких констант, `.map` и
 * `Object.entries/keys/values` объекта-литерала). Прежде таблица из
 * переменной шла за 5 строк, и «золотая» спека на 114 случаев оценивалась
 * в 5 тестов. `let`, имя, объявленное в файле дважды, `.filter` и распаковка
 * неизвестного — не доказуемы: оценка повторов и `certain: false`.
 *
 * Без TypeScript (его нет в проекте) — подсчёт вызовов регуляркой; `.each`
 * или ни одного вызова — `certain: false`.
 *
 * `typescript` — JS API (5.x, 6.x, `@typescript/typescript6`); модуль без
 * него (главный вход TypeScript 7) — отказ с объяснением, а не TypeError на
 * первом обращении.
 */
export const assessTests = (typescript: TypescriptApi | null, path: string, text: string): TestAssessment => {
  if (typescript === null) {
    const calls = (text.match(FALLBACK_TEST_CALL) ?? []).length;
    return { tests: Math.max(1, calls), certain: calls > 0 && !FALLBACK_UNKNOWN_REPEAT.test(text) };
  }
  if (!isTypescriptApi(typescript)) {
    const version = (typescript as { version?: unknown }).version;
    throw new JestGroupsError(
      `typescript ${typeof version === 'string' ? version : 'неизвестной версии'} без JS API ` +
        `(нужны ${TYPESCRIPT_API_MEMBERS.functions.length} функций, createSourceFile и др.): у TypeScript 7 ` +
        'главный вход — только { version }; передайте @typescript/typescript6 или null (оценка регуляркой)',
    );
  }
  // Внутри — типы API той линии, на которой собран пакет; наружу они не выходят.
  const ts = typescript as unknown as typeof Ts;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

  // Константы файла по имени; имя, объявленное больше одного раза, — не доказуемо.
  const declarations = new Map<string, Ts.VariableDeclaration[]>();
  const collect = (node: Ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, [...(declarations.get(node.name.text) ?? []), node]);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  let certain = true;
  const unknown = (): number => {
    certain = false;
    return GROUP_DEFAULTS.UNKNOWN_REPEAT;
  };
  const unwrap = (node: Ts.Expression): Ts.Expression => {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  /** Инициализатор единственной const-декларации имени; иначе null. */
  const constant = (name: string): Ts.Expression | null => {
    const found = declarations.get(name) ?? [];
    const only = found[0];
    if (found.length !== 1 || only === undefined || only.initializer === undefined) {
      return null;
    }
    const list = only.parent;
    return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0
      ? only.initializer
      : null;
  };
  /** Длина таблицы, если текст её доказывает; иначе null. */
  const lengthOf = (node: Ts.Expression, depth: number): number | null => {
    if (depth > 8) {
      return null;
    }
    const value = unwrap(node);
    if (ts.isArrayLiteralExpression(value)) {
      let total = 0;
      for (const element of value.elements) {
        if (ts.isSpreadElement(element)) {
          const inner = lengthOf(element.expression, depth + 1);
          if (inner === null) {
            return null;
          }
          total += inner;
        } else {
          total += 1;
        }
      }
      return total;
    }
    if (ts.isIdentifier(value)) {
      const initializer = constant(value.text);
      return initializer === null ? null : lengthOf(initializer, depth + 1);
    }
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
      const method = value.expression.name.text;
      const receiver = value.expression.expression;
      if (method === 'map') {
        return lengthOf(receiver, depth + 1);
      }
      const argument = value.arguments[0];
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === 'Object' &&
        ['entries', 'keys', 'values'].includes(method) &&
        argument !== undefined
      ) {
        return propertiesOf(argument, depth + 1);
      }
    }
    return null;
  };
  const propertiesOf = (node: Ts.Expression, depth: number): number | null => {
    const value = unwrap(node);
    if (ts.isIdentifier(value)) {
      const initializer = constant(value.text);
      return initializer === null || depth > 8 ? null : propertiesOf(initializer, depth + 1);
    }
    if (
      ts.isObjectLiteralExpression(value) &&
      value.properties.every((property) => !ts.isSpreadAssignment(property))
    ) {
      return value.properties.length;
    }
    return null;
  };
  const tableSize = (node: Ts.Expression | undefined): number =>
    (node === undefined ? null : lengthOf(node, 0)) ?? unknown();

  const rootName = (node: Ts.Node): string | null => {
    let current = node;
    while (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    }
    return ts.isIdentifier(current) ? current.text : null;
  };
  const isEach = (node: Ts.Node): boolean => ts.isPropertyAccessExpression(node) && node.name.text === 'each';
  // Строки таблицы без заголовка. Непустые строки, а не строки с `|`: таблица
  // из одной колонки разделителей не имеет, и по `|` её строк было ноль.
  const templateRows = (template: Ts.Node): number =>
    Math.max(
      1,
      template
        .getText(source)
        .replace(/^`|`$/g, '')
        .split('\n')
        .filter((line) => line.trim() !== '').length - 1,
    );
  /** Множитель вычисляется один раз и только по требованию. */
  const once = (size: () => number): (() => number) => {
    let value: number | undefined;
    return () => {
      value ??= size();
      return value;
    };
  };
  // Множитель повтора узла; неизвестный — лениво: только если внутри есть тест.
  const loopSize = (node: Ts.Node): (() => number) | null => {
    if (ts.isForOfStatement(node)) {
      return once(() => tableSize(node.expression));
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node)) {
      return unknown;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ITERATING_METHODS.has(node.expression.name.text)
    ) {
      const receiver = node.expression.expression;
      return once(() => tableSize(receiver));
    }
    return null;
  };

  let total = 0;
  /** Тест под повтором `repeat` — множитель повтора вычисляется только здесь. */
  const count = (repeat: readonly (() => number)[], times: number): void => {
    total += repeat.reduce((product, size) => product * size(), times);
  };
  const visitTable = (
    node: Ts.CallExpression,
    name: string | null,
    size: () => number,
    repeat: readonly (() => number)[],
  ): boolean => {
    if (name !== null && TEST_CALLEES.has(name)) {
      count([...repeat, size], 1);
      return true;
    }
    if (name === 'describe') {
      for (const argument of node.arguments) {
        visit(argument, [...repeat, size]);
      }
      return true;
    }
    return false;
  };
  const visit = (node: Ts.Node, repeat: readonly (() => number)[]): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // it.each([...])('имя', fn) и describe.each([...])('имя', fn)
      if (ts.isCallExpression(callee) && isEach(callee.expression)) {
        if (
          visitTable(
            node,
            rootName(callee.expression),
            once(() => tableSize(callee.arguments[0])),
            repeat,
          )
        ) {
          return;
        }
      }
      // it.each`таблица`('имя', fn)
      if (ts.isTaggedTemplateExpression(callee) && isEach(callee.tag)) {
        if (
          visitTable(
            node,
            rootName(callee.tag),
            once(() => templateRows(callee.template)),
            repeat,
          )
        ) {
          return;
        }
      }
      const name = rootName(callee);
      if (name !== null && TEST_CALLEES.has(name) && !isEach(callee)) {
        count(repeat, 1);
        return;
      }
    }
    const loop = loopSize(node);
    const inner = loop === null ? repeat : [...repeat, loop];
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(source, []);
  return { tests: Math.max(1, total), certain: certain && total > 0 };
};
