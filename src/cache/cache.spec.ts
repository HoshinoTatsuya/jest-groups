import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cacheKey } from './cache-key';
import { isCacheEntry } from './is-cache-entry';
import { plannedTests } from './planned-tests';
import { readTestCache } from './read-test-cache';
import { writeTestCache } from './write-test-cache';

describe('plannedTests: свежесть факта — по отпечатку файла', () => {
  const entry = { tests: 10, mtimeMs: 1000, size: 50 };
  const assess =
    (tests: number, certain = true) =>
    () => ({ tests, certain });
  const never = () => {
    throw new Error('оценка свежему факту не нужна');
  };

  it('отпечаток совпал — факт, текст не читается', () => {
    expect(plannedTests(entry, { mtimeMs: 1000, size: 50 }, never, 285, 'ast')).toBe(10);
  });

  it.each([
    ['другой mtime', { mtimeMs: 1001, size: 50 }],
    ['другой размер (правка в ту же миллисекунду)', { mtimeMs: 1000, size: 49 }],
    ['файл не прочитан', null],
  ])('запись без оценки (до 0.6.0), %s — большее из факта и оценки × 1.25', (_case, stamp) => {
    expect(plannedTests(entry, stamp, assess(300), 285, 'ast')).toBe(375);
    // Факт больше оценки: факт (оценка занижает).
    expect(plannedTests({ ...entry, tests: 500 }, stamp, assess(300), 285, 'ast')).toBe(500);
  });

  it('истории нет — оценка × 1.25; текст числа не доказывает — полная группа плана', () => {
    expect(plannedTests(undefined, { mtimeMs: 1, size: 1 }, assess(300), 285, 'ast')).toBe(375);
    expect(plannedTests(undefined, { mtimeMs: 1, size: 1 }, assess(4, false), 285, 'ast')).toBe(285);
    expect(plannedTests(undefined, { mtimeMs: 1, size: 1 }, assess(300, false), 285, 'ast')).toBe(375);
  });
});

describe('plannedTests: изменённый файл — калибровка факта, а не «большее из факта и оценки»', () => {
  const changed = { mtimeMs: 2000, size: 1000 };

  it('видимых тестов стало больше — прирост × (факт / оценка того же содержимого)', () => {
    // Факт 130 при оценке 11: каждый видимый тест файла — 130/11 настоящих.
    const entry = { tests: 130, mtimeMs: 1000, size: 1000, estimate: 11 };
    expect(plannedTests(entry, changed, () => ({ tests: 36, certain: true }), 285, 'ast')).toBe(130 + 296);
  });

  it('калибровка не ниже единицы: переоценённый файл растёт хотя бы на прирост', () => {
    const entry = { tests: 10, mtimeMs: 1000, size: 1000, estimate: 20 };
    expect(plannedTests(entry, changed, () => ({ tests: 25, certain: true }), 285, 'ast')).toBe(15);
  });

  it('текст тот же или тестов меньше — факт (не «оценка × 1.25»)', () => {
    const entry = { tests: 10, mtimeMs: 1000, size: 1000, estimate: 20 };
    expect(plannedTests(entry, changed, () => ({ tests: 20, certain: true }), 285, 'ast')).toBe(10);
    expect(plannedTests(entry, changed, () => ({ tests: 3, certain: true }), 285, 'ast')).toBe(10);
  });

  it('файл вырос по размеру, а видимых тестов столько же — факт растёт с размером', () => {
    const entry = { tests: 100, mtimeMs: 1000, size: 1000, estimate: 10 };
    expect(
      plannedTests(entry, { mtimeMs: 2000, size: 1500 }, () => ({ tests: 10, certain: true }), 285, 'ast'),
    ).toBe(150);
    // Записи до 0.6.0 — тоже; отпечаток прежнего кэша (размер −1) рост не мерит.
    expect(
      plannedTests(
        { tests: 100, mtimeMs: 1000, size: 1000 },
        { mtimeMs: 2000, size: 1500 },
        () => ({
          tests: 10,
          certain: true,
        }),
        285,
        'ast',
      ),
    ).toBe(150);
    expect(
      plannedTests(
        { tests: 100, mtimeMs: -1, size: -1 },
        { mtimeMs: 2000, size: 1500 },
        () => ({
          tests: 10,
          certain: true,
        }),
        285,
        'ast',
      ),
    ).toBe(100);
  });
});

describe('plannedTests: оценка записи другим оценщиком не калибрует', () => {
  const changed = { mtimeMs: 2000, size: 1000 };
  const ast50 = () => ({ tests: 50, certain: true });

  it('регулярка 1 при факте 50, теперь AST 50 — без калибровки ×50: факт против оценки × 1.25', () => {
    const entry = { tests: 50, mtimeMs: 1000, size: 1000, estimate: 1, estimator: 'regex' as const };
    expect(plannedTests(entry, changed, ast50, 285, 'ast')).toBe(63);
    // Контроль: та же пара от ТОГО ЖЕ оценщика калибрует — 50 + 49 × 50.
    expect(plannedTests({ ...entry, estimator: 'ast' }, changed, ast50, 285, 'ast')).toBe(50 + 49 * 50);
  });

  it('запись до 0.6.1 (оценщик не записан) — оценка текущего оценщика', () => {
    const entry = { tests: 50, mtimeMs: 1000, size: 1000, estimate: 1 };
    expect(plannedTests(entry, changed, ast50, 285, 'ast')).toBe(50 + 49 * 50);
  });

  it('оценщик в записи: ast и regex — запись; иное — «истории нет»', () => {
    const entry = { tests: 1, mtimeMs: 1, size: 0, estimate: 3 };
    expect(isCacheEntry({ ...entry, estimator: 'ast' })).toBe(true);
    expect(isCacheEntry({ ...entry, estimator: 'regex' })).toBe(true);
    expect(isCacheEntry({ ...entry, estimator: 'typescript' })).toBe(false);
    expect(isCacheEntry({ ...entry, estimator: 1 })).toBe(false);
  });
});

describe('кэш команды на диске', () => {
  let dir = '';
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-cache-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ключ различает инструмент и команду, но не зависит от вызова', () => {
    expect(cacheKey('jest', ['jest'])).toBe(cacheKey('jest', ['jest']));
    expect(cacheKey('jest', ['jest'])).not.toBe(cacheKey('jest', ['jest', '--config', 'db.js']));
    expect(cacheKey('jest', ['x'])).not.toBe(cacheKey('vitest', ['x']));
    expect(cacheKey('jest', ['jest'])).toMatch(/^jest-[0-9a-f]{16}$/);
  });

  it('запись и чтение; записи удалённых файлов снимаются, невыполненных — остаются', () => {
    writeFileSync(join(dir, 'kept.spec.ts'), '');
    writeFileSync(join(dir, 'idle.spec.ts'), '');
    const cache = {
      version: 2 as const,
      command: ['jest'],
      files: {
        'kept.spec.ts': { tests: 3, mtimeMs: 1, size: 0, durationMs: 40 },
        'idle.spec.ts': { tests: 7, mtimeMs: 2, size: 0 },
        'deleted.spec.ts': { tests: 9, mtimeMs: 3, size: 0 },
      },
    };
    writeTestCache(join(dir, 'c'), 'k', cache, dir);
    expect(readTestCache(join(dir, 'c'), 'k', ['jest']).files).toEqual({
      'idle.spec.ts': { tests: 7, mtimeMs: 2, size: 0 },
      'kept.spec.ts': { tests: 3, mtimeMs: 1, size: 0, durationMs: 40 },
    });
  });

  it('записи не той формы — «истории нет» по файлу, а не отказ всего кэша', () => {
    mkdirSync(join(dir, 'c'));
    writeFileSync(
      join(dir, 'c', 'k.json'),
      JSON.stringify({
        files: {
          'ok.spec.ts': { tests: 2, mtimeMs: 5, size: 1 },
          'zero.spec.ts': { tests: 0, mtimeMs: 5, size: 1 },
          'no-stamp.spec.ts': { tests: 2 },
          'legacy.spec.ts': 4,
        },
      }),
    );
    expect(Object.keys(readTestCache(join(dir, 'c'), 'k', []).files)).toEqual(['ok.spec.ts']);
  });

  it('своей истории нет — факты из counts.json до 0.5.0 с отпечатком, который не совпадёт', () => {
    mkdirSync(join(dir, 'c'));
    writeFileSync(join(dir, 'c', 'counts.json'), JSON.stringify({ 'a.spec.ts': 12, 'b.spec.ts': 'x' }));
    const files = readTestCache(join(dir, 'c'), 'k', []).files;
    expect(files).toEqual({ 'a.spec.ts': { tests: 12, mtimeMs: -1, size: -1 } });
    expect(
      plannedTests(
        files['a.spec.ts'],
        { mtimeMs: -1 + 1, size: 0 },
        () => ({ tests: 1, certain: true }),
        285,
        'ast',
      ),
    ).toBe(12);
  });

  it('своя история есть — counts.json не читается', () => {
    mkdirSync(join(dir, 'c'));
    writeFileSync(join(dir, 'c', 'counts.json'), JSON.stringify({ 'a.spec.ts': 12 }));
    writeFileSync(join(dir, 'c', 'k.json'), JSON.stringify({ files: {} }));
    expect(readTestCache(join(dir, 'c'), 'k', []).files).toEqual({});
  });

  it('файл кэша записан отсортированным и целиком (JSON)', () => {
    writeFileSync(join(dir, 'b'), '');
    writeFileSync(join(dir, 'a'), '');
    writeTestCache(
      join(dir, 'c'),
      'k',
      {
        version: 2,
        command: [],
        files: { b: { tests: 1, mtimeMs: 1, size: 0 }, a: { tests: 1, mtimeMs: 1, size: 0 } },
      },
      dir,
    );
    expect(
      Object.keys((JSON.parse(readFileSync(join(dir, 'c', 'k.json'), 'utf8')) as { files: object }).files),
    ).toEqual(['a', 'b']);
  });

  it('isCacheEntry: длительность — число ≥ 0 или нет её; оценка — целое > 0 или нет её', () => {
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, durationMs: 0 })).toBe(true);
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, estimate: 3 })).toBe(true);
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, estimate: 0 })).toBe(false);
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, estimate: 2.5 })).toBe(false);
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, estimate: '3' })).toBe(false);
    expect(isCacheEntry({ tests: 1, mtimeMs: 1, size: 0, durationMs: -1 })).toBe(false);
    expect(isCacheEntry({ tests: 1.5, mtimeMs: 1, size: 0 })).toBe(false);
    expect(isCacheEntry({ tests: 1, mtimeMs: Number.NaN, size: 0 })).toBe(false);
    expect(isCacheEntry(null)).toBe(false);
  });
});
