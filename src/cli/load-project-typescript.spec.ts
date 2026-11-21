import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadProjectTypescript } from './load-project-typescript';

/**
 * Выбор JS API для оценки по тексту в проекте: `typescript` проекта с API →
 * `@typescript/typescript6` проекта → регулярка. Проект — временный каталог,
 * в node_modules которого лежат ссылки на настоящие пакеты библиотеки
 * (typescript 5.9.3, 6.0.3, 7.0.2 и @typescript/typescript6 6.0.2).
 */
const LIBRARY_MODULES = join(__dirname, '..', '..', 'node_modules');

describe('loadProjectTypescript', () => {
  let work = '';
  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-ts-')));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const link = (name: string, pkg: string): void => {
    mkdirSync(dirname(join(work, 'node_modules', name)), { recursive: true });
    symlinkSync(realpathSync(join(LIBRARY_MODULES, pkg)), join(work, 'node_modules', name), 'dir');
  };
  const loaded = () => {
    const result = loadProjectTypescript(work);
    return { version: result.typescript?.version ?? null, note: result.note };
  };

  it.each([
    ['5.9.3', 'typescript'],
    ['6.0.3', 'typescript-6'],
  ])('TypeScript %s проекта — он сам, без строки, даже если рядом есть typescript6', (version, pkg) => {
    link('typescript', pkg);
    link('@typescript/typescript6', '@typescript/typescript6');
    expect(loaded()).toEqual({ version, note: null });
    // Тот самый модуль проекта, а не копия библиотеки.
    expect(loadProjectTypescript(work).typescript).toBe(
      require(realpathSync(join(work, 'node_modules', 'typescript'))),
    );
  });

  it('TypeScript 7 + @typescript/typescript6 — API из typescript6 и строка, почему', () => {
    link('typescript', 'typescript-7');
    link('@typescript/typescript6', '@typescript/typescript6');
    expect(loaded()).toEqual({
      version: '6.0.3',
      note: 'TypeScript проекта 7.0.2 без JS API: оценка по @typescript/typescript6 6.0.3',
    });
  });

  it('TypeScript 7 без typescript6 — регулярка и строка с подсказкой, а не отказ', () => {
    link('typescript', 'typescript-7');
    const result = loaded();
    expect(result.version).toBeNull();
    expect(result.note).toMatch(
      /^TypeScript проекта 7\.0\.2 без JS API, @typescript\/typescript6 не установлен: оценка регуляркой — .*@typescript\/typescript6 в devDependencies проекта$/,
    );
  });

  it('TypeScript в проекте нет — регулярка молча (JS-проект)', () => {
    expect(loaded()).toEqual({ version: null, note: null });
  });

  // Отдельным тестом: песочница jest помнит неудачный поиск модуля из того же каталога.
  it('TypeScript в проекте нет, typescript6 есть — берётся молча', () => {
    link('@typescript/typescript6', '@typescript/typescript6');
    expect(loaded()).toEqual({ version: '6.0.3', note: null });
  });

  it('typescript, который не загрузился (нет его зависимости), — не «его нет»: строка с причиной', () => {
    mkdirSync(join(work, 'node_modules', 'typescript'), { recursive: true });
    writeFileSync(
      join(work, 'node_modules', 'typescript', 'package.json'),
      '{"name":"typescript","version":"9.9.9"}',
    );
    writeFileSync(
      join(work, 'node_modules', 'typescript', 'index.js'),
      "require('absent-dependency-of-ts');",
    );
    const result = loaded();
    expect(result.version).toBeNull();
    expect(result.note).toMatch(
      /^TypeScript проекта не загрузился \(Cannot find module 'absent-dependency-of-ts'.*\), @typescript\/typescript6 не установлен: оценка регуляркой/,
    );
  });

  it('typescript6 без API (подменён) — регулярка со строкой, а не TypeError на разборе', () => {
    link('typescript', 'typescript-7');
    mkdirSync(join(work, 'node_modules', '@typescript', 'typescript6'), { recursive: true });
    writeFileSync(join(work, 'node_modules', '@typescript', 'typescript6', 'package.json'), '{"name":"x"}');
    writeFileSync(
      join(work, 'node_modules', '@typescript', 'typescript6', 'index.js'),
      "exports.version = '6.0.0';",
    );
    expect(loaded()).toEqual({
      version: null,
      note: expect.stringMatching(
        /^TypeScript проекта 7\.0\.2 без JS API, @typescript\/typescript6 6\.0\.0 без JS API: оценка регуляркой/,
      ),
    });
  });
});
