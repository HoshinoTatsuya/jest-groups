import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { RunnerSandbox } from '../testing/runner-sandbox';

/**
 * Собранный `jest-groups` в проекте с TypeScript каждой поддерживаемой линии.
 * Оценку по тексту делает AST: TypeScript проекта, если у него есть JS API
 * (5.9, 6.x), иначе `@typescript/typescript6` проекта (у TypeScript 7 главный
 * вход — только `{version}`), иначе регулярка со строкой в журнале. Прежде
 * TypeScript 7 в проекте ронял весь раннер кодом 2 («Cannot read properties
 * of undefined (reading 'Latest')»).
 *
 * Различие путей видно в плане: таблица `.each` из 8 строк по AST — 10 тестов
 * (8 × 1.25), регулярка её не считает — полная группа плана (285).
 */
const ROOT = join(__dirname, '..', '..');
const RUNNER = join(ROOT, 'dist', 'bin', 'jest-groups.js');
const TABLE_SPEC = "it.each([[1], [2], [3], [4], [5], [6], [7], [8]])('%s', () => undefined);\n";

const LINES = [
  ['5.9', 'typescript', '5.9.3'],
  ['6.0', 'typescript-6', '6.0.3'],
  ['7.0 (latest, без JS API)', 'typescript-7', '7.0.2'],
] as const;

describe('jest-groups: TypeScript проекта каждой линии', () => {
  const sandboxes: RunnerSandbox[] = [];
  afterEach(() => {
    for (const sandbox of sandboxes.splice(0)) {
      sandbox.dispose();
    }
  });
  /** Проект, в node_modules которого лежат `links`: имя модуля → пакет из node_modules библиотеки. */
  const project = (links: Record<string, string>): RunnerSandbox => {
    const sandbox = new RunnerSandbox(RUNNER);
    sandboxes.push(sandbox);
    for (const [name, pkg] of Object.entries(links)) {
      mkdirSync(dirname(sandbox.abs(`node_modules/${name}`)), { recursive: true });
      symlinkSync(realpathSync(join(ROOT, 'node_modules', pkg)), sandbox.abs(`node_modules/${name}`), 'dir');
    }
    sandbox.setCounts({ 'a.spec.ts': 8 });
    writeFileSync(sandbox.abs('a.spec.ts'), TABLE_SPEC);
    return sandbox;
  };

  it('фикстуры различны: в проект подкладываются три разные версии', () => {
    const versions = LINES.map(
      ([, pkg]) =>
        (createRequire(join(ROOT, 'package.json'))(`${pkg}/package.json`) as { version: string }).version,
    );
    expect(versions).toEqual(LINES.map(([, , version]) => version));
  });

  it.each(LINES)(
    'TypeScript %s (с @typescript/typescript6 в проекте): таблица .each по AST — план 10',
    (_line, pkg, version) => {
      const result = project({
        typescript: pkg,
        '@typescript/typescript6': '@typescript/typescript6',
      }).invoke({
        flags: ['--dry-run'],
      });

      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
      expect(result.stdout).toContain('группа 1: файлов 1, тестов по плану 10');
      // Запасной пакет берётся, только когда у TypeScript проекта нет JS API.
      expect(result.stdout.includes('оценка по @typescript/typescript6 6.0.3')).toBe(
        version.startsWith('7.'),
      );
    },
  );

  it.each(LINES)(
    'TypeScript %s без @typescript/typescript6: 5.9 и 6 — AST, 7 — регулярка со строкой',
    (_line, pkg, version) => {
      const result = project({ typescript: pkg }).invoke({ flags: ['--dry-run'] });

      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
      const latest = version.startsWith('7.');
      expect(result.stdout).toContain(`группа 1: файлов 1, тестов по плану ${latest ? 285 : 10}`);
      expect(
        result.stdout.includes(
          `[группы jest] TypeScript проекта ${version} без JS API, @typescript/typescript6 не установлен: оценка регуляркой`,
        ),
      ).toBe(latest);
    },
  );

  it('без TypeScript в проекте — регулярка молча: таблица не доказана — полная группа плана', () => {
    const result = project({}).invoke({ flags: ['--dry-run'] });

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).toContain('группа 1: файлов 1, тестов по плану 285');
    expect(result.stdout).not.toContain('typescript');
  });

  /** Запись кэша о спеке после прогона. */
  const cached = (sandbox: RunnerSandbox) => {
    // Рядом с кэшем — состояние прошлого прогона (`*.last-run.json`).
    const files = sandbox.cacheFiles().filter((name) => !name.endsWith('.last-run.json'));
    expect(files).toHaveLength(1);
    const parsed = JSON.parse(
      readFileSync(join(sandbox.abs('node_modules/.cache/jest-test-groups'), files[0] ?? ''), 'utf8'),
    ) as { files: Record<string, { tests: number; estimate?: number; estimator?: string }> };
    return parsed.files['a.spec.ts'];
  };
  /** Прогон без TypeScript (регулярка), потом в проекте появляется TypeScript 5.9. */
  const regexThenTypescript = (): RunnerSandbox => {
    const sandbox = project({});
    expect(sandbox.invoke().status).toBe(0);
    // Факт 8 при оценке регуляркой 1 (таблицу она не считает).
    expect(cached(sandbox)).toMatchObject({ tests: 8, estimate: 1, estimator: 'regex' });
    symlinkSync(
      realpathSync(join(ROOT, 'node_modules', 'typescript')),
      sandbox.abs('node_modules/typescript'),
      'dir',
    );
    return sandbox;
  };

  it('файл не менялся, оценщик сменился — в кэш ложится оценка нового оценщика, а не прежняя', () => {
    const sandbox = regexThenTypescript();
    expect(sandbox.invoke().status).toBe(0);
    expect(cached(sandbox)).toMatchObject({ tests: 8, estimate: 8, estimator: 'ast' });
  });

  it('оценка регуляркой в кэше не калибрует AST: TypeScript появился — изменённый файл не раздут', () => {
    const sandbox = regexThenTypescript();
    const before = statSync(sandbox.abs('a.spec.ts')).size;
    writeFileSync(
      sandbox.abs('a.spec.ts'),
      "it.each([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]])('%s', () => undefined);\n",
    );
    const after = statSync(sandbox.abs('a.spec.ts')).size;
    const result = sandbox.invoke({ flags: ['--dry-run'] });

    // Пара «факт 8 / оценка 1» — от другого оценщика: калибровка ×8 дала бы
    // 8 + (10 − 1) × 8 = 80. План — без неё: факт, оценка × 1.25, рост размера.
    const expected = Math.max(8, Math.ceil(10 * 1.25), Math.ceil((8 * after) / before));
    expect(expected).toBeLessThan(80);
    expect(result.stdout).toContain(`группа 1: файлов 1, тестов по плану ${expected}`);
  });
});
