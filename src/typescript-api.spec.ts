import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as ts59 from 'typescript';

import { assessTests } from './assess-tests';
import { TYPESCRIPT_API_MEMBERS } from './constants/typescript-api-members.constant';
import { isTypescriptApi } from './is-typescript-api';
import { JestGroupsError } from './jest-groups.error';
import { ASSESS_CORPUS } from './testing/assess-corpus';

/**
 * JS API TypeScript для оценки по тексту — на всех поддерживаемых линиях:
 * TypeScript 5.9 и 6.0 дают API главным входом, у TypeScript 7 главный вход —
 * только `{ version }`, прежний API — пакет `@typescript/typescript6`.
 */
const ROOT = join(__dirname, '..');
const ts6 = require('typescript-6') as unknown;
const ts7 = require('typescript-7') as unknown;
const typescript6 = require('@typescript/typescript6') as unknown;

describe('JS API TypeScript: что раннер считает API', () => {
  it('фикстуры различны: 5.9.3, 6.0.3, главный вход 7.0.2 и typescript6 6.0.3', () => {
    const version = (module: unknown) => (module as { version: string }).version;
    expect([ts59, ts6, ts7, typescript6].map(version)).toEqual(['5.9.3', '6.0.3', '7.0.2', '6.0.3']);
  });

  it('API: 5.9, 6.0 и @typescript/typescript6; главный вход TypeScript 7 и не модули — нет', () => {
    expect([ts59, ts6, typescript6].map(isTypescriptApi)).toEqual([true, true, true]);
    expect([ts7, null, undefined, {}, 'typescript'].map(isTypescriptApi)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('без ЛЮБОГО одного нужного члена — не API (каждый проверяется)', () => {
    const removed = [
      ...TYPESCRIPT_API_MEMBERS.functions.map((name) => {
        const copy: Record<string, unknown> = { ...ts59 };
        delete copy[name];
        return [name, isTypescriptApi(copy)] as const;
      }),
      ...Object.entries(TYPESCRIPT_API_MEMBERS.enums).flatMap(([name, members]) =>
        members.map((member) => {
          const copy: Record<string, unknown> = {
            ...ts59,
            [name]: { ...(ts59 as unknown as Record<string, object>)[name], [member]: undefined },
          };
          return [`${name}.${member}`, isTypescriptApi(copy)] as const;
        }),
      ),
    ];
    expect(removed.length).toBeGreaterThan(20);
    expect(removed.filter(([, api]) => api)).toEqual([]);
  });

  it('список членов полон: каждое обращение ts.* в оценке — в нём, и ничего лишнего', () => {
    const source = readFileSync(join(__dirname, 'assess-tests.ts'), 'utf8');
    const used = [...source.matchAll(/\bts\.([A-Za-z]+)(?:\.([A-Za-z]+))?/g)];
    const functions = [
      ...new Set(used.filter(([, , member]) => member === undefined).map(([, name]) => name)),
    ];
    const enums = [
      ...new Set(
        used.filter(([, , member]) => member !== undefined).map(([, name, member]) => `${name}.${member}`),
      ),
    ];
    expect(used.length).toBeGreaterThan(30);
    expect(functions.sort()).toEqual([...TYPESCRIPT_API_MEMBERS.functions].sort());
    expect(enums.sort()).toEqual(
      Object.entries(TYPESCRIPT_API_MEMBERS.enums)
        .flatMap(([name, members]) => members.map((member) => `${name}.${member}`))
        .sort(),
    );
  });

  it('главный вход TypeScript 7 в оценку — отказ раннера (код 2) с объяснением, а не TypeError', () => {
    const attempt = () => assessTests(ts7 as never, 'x.spec.ts', "it('a', f);");
    expect(attempt).toThrow(JestGroupsError);
    expect(attempt).toThrow(/^typescript 7\.0\.2 без JS API .*@typescript\/typescript6 или null/);
    try {
      attempt();
    } catch (error) {
      expect((error as JestGroupsError).exitCode).toBe(2);
    }
  });

  it('объявления пакета (dist/**/*.d.ts) не ссылаются на модуль typescript: у TypeScript 7 этих типов нет', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.d.ts') ? [path] : [];
      });
    const declarations = walk(join(ROOT, 'dist'));
    expect(declarations.length).toBeGreaterThan(30);
    const offenders = declarations.filter((path) =>
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|reference\s+types\s*=\s*)['"]typescript(?:\/[^'"]*)?['"]/.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('оценка по тексту: одинакова на каждом JS API, регулярка — как задокументировано', () => {
  const APIS = [
    ['TypeScript 5.9.3', ts59],
    ['TypeScript 6.0.3', ts6],
    ['@typescript/typescript6 6.0.2', typescript6],
  ] as const;

  it('корпус не выродился: есть и доказанные, и недоказанные, и расхождения путей', () => {
    expect(ASSESS_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(ASSESS_CORPUS.some(([, , ast]) => ast.certain)).toBe(true);
    expect(ASSESS_CORPUS.some(([, , ast]) => !ast.certain)).toBe(true);
    expect(ASSESS_CORPUS.some(([, , ast, regex]) => ast.tests !== regex.tests)).toBe(true);
  });

  it.each(APIS)('%s: каждая фикстура — ожидание AST', (_name, api) => {
    const actual = ASSESS_CORPUS.map(([name, text]) => [name, assessTests(api as never, 'x.spec.ts', text)]);
    expect(actual).toEqual(ASSESS_CORPUS.map(([name, , ast]) => [name, ast]));
  });

  it('регулярка (TypeScript нет): каждая фикстура — её задокументированное ожидание', () => {
    const actual = ASSESS_CORPUS.map(([name, text]) => [name, assessTests(null, 'x.spec.ts', text)]);
    expect(actual).toEqual(ASSESS_CORPUS.map(([name, , , regex]) => [name, regex]));
  });
});
