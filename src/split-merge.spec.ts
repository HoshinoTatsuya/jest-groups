import { mergeCoverage } from './merge-coverage';
import { splitByArgvBudget } from './split-by-argv-budget';

describe('splitByArgvBudget', () => {
  const length = (file: string): number => file.length;

  it('группа сверх потолка делится, каждая часть укладывается', () => {
    // fixed 10 + по (длина + 1) на файл: 'aaaa' → 5. Потолок 21: два файла.
    const parts = splitByArgvBudget([['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']], 21, 10, length);
    expect(parts).toEqual([['aaaa', 'bbbb'], ['cccc', 'dddd'], ['eeee']]);
  });

  it('ровно на потолке — без деления', () => {
    expect(splitByArgvBudget([['aaaa', 'bbbb']], 20, 10, length)).toEqual([['aaaa', 'bbbb']]);
  });

  it('файл длиннее потолка — отдельным запуском, остальные не страдают', () => {
    expect(splitByArgvBudget([['a', 'x'.repeat(100), 'b']], 20, 10, length)).toEqual([
      ['a'],
      ['x'.repeat(100)],
      ['b'],
    ]);
  });

  it('группы не смешиваются', () => {
    expect(splitByArgvBudget([['a'], ['b']], 1_000, 0, length)).toEqual([['a'], ['b']]);
  });
});

describe('mergeCoverage', () => {
  it('файл из двух групп — счётчики складываются, остальные поля сохраняются', () => {
    const shared = (s0: number, s1: number, b: number[]) => ({
      path: '/src/shared.ts',
      statementMap: { '0': {}, '1': {} },
      s: { '0': s0, '1': s1 },
      f: { '0': s0 },
      b: { '0': b },
    });
    const merged = mergeCoverage([
      { '/src/shared.ts': shared(1, 0, [1, 0]), '/src/a.ts': { path: '/src/a.ts', s: { '0': 3 } } },
      { '/src/shared.ts': shared(0, 2, [0, 4]), '/src/b.ts': { path: '/src/b.ts', s: { '0': 1 } } },
    ]);
    expect(Object.keys(merged).sort()).toEqual(['/src/a.ts', '/src/b.ts', '/src/shared.ts']);
    expect(merged['/src/shared.ts']).toEqual({
      path: '/src/shared.ts',
      statementMap: { '0': {}, '1': {} },
      s: { '0': 1, '1': 2 },
      f: { '0': 1 },
      b: { '0': [1, 4] },
    });
  });

  it('win32: разделители и буква диска одного файла сводятся к одному ключу, регистр пути — нет', () => {
    const file = (path: string, hits: number) => ({
      path,
      statementMap: { '0': {} },
      s: { '0': hits },
      f: {},
      b: {},
    });
    const merged = mergeCoverage(
      [
        { 'C:/src/a.ts': file('C:/src/a.ts', 1), 'C:\\src\\Foo.ts': file('C:\\src\\Foo.ts', 1) },
        { 'c:\\src\\a.ts': file('c:\\src\\a.ts', 2), 'C:\\src\\foo.ts': file('C:\\src\\foo.ts', 1) },
      ],
      { platform: 'win32' },
    );
    expect(Object.keys(merged).sort()).toEqual(['C:\\src\\Foo.ts', 'C:\\src\\a.ts', 'C:\\src\\foo.ts']);
    expect(merged['C:\\src\\a.ts']).toEqual(file('C:\\src\\a.ts', 3));
  });

  it('вне win32 путь не трогается: `\\` в имени POSIX — обычный символ', () => {
    const merged = mergeCoverage(
      [
        { '/src/a\\b.ts': { path: '/src/a\\b.ts', s: { '0': 1 } } },
        { '/src/a/b.ts': { path: '/src/a/b.ts', s: { '0': 1 } } },
      ],
      { platform: 'linux' },
    );
    expect(Object.keys(merged).sort()).toEqual(['/src/a/b.ts', '/src/a\\b.ts']);
  });
});
