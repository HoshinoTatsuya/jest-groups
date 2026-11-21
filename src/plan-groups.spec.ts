import { planCap } from './plan-cap';
import { planGroups } from './plan-groups';

describe('planGroups', () => {
  it('держит каждую группу не выше потолка', () => {
    const entries = [
      { file: 'a', tests: 100 },
      { file: 'b', tests: 150 },
      { file: 'c', tests: 60 },
      { file: 'd', tests: 30 },
    ];
    const groups = planGroups(entries, 285);
    const tests = new Map(entries.map(({ file, tests: n }) => [file, n]));
    for (const group of groups) {
      expect(group.reduce((sum, file) => sum + (tests.get(file) ?? 0), 0)).toBeLessThanOrEqual(285);
    }
    expect(groups.flat().sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('упаковка от тяжёлых к лёгким: групп меньше, чем по порядку имён', () => {
    // По порядку имён: [a], [b, c], [d] — три запуска jest. По убыванию с
    // первым подходящим местом: [a, c], [b, d] — два, каждый ровно 285.
    const entries = [
      { file: 'a', tests: 150 },
      { file: 'b', tests: 150 },
      { file: 'c', tests: 135 },
      { file: 'd', tests: 135 },
    ];
    expect(planGroups(entries, 285)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('сначала тяжёлые: первое подходящее место по порядку имён дало бы лишнюю группу', () => {
    // По именам с первым подходящим местом: [a, b], [c], [d] — три. От
    // тяжёлых: [c, a], [d, b] — две.
    const entries = [
      { file: 'a', tests: 100 },
      { file: 'b', tests: 100 },
      { file: 'c', tests: 185 },
      { file: 'd', tests: 185 },
    ];
    expect(planGroups(entries, 285)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('раскладка не зависит от порядка входа', () => {
    const entries = [
      { file: 'x', tests: 40 },
      { file: 'y', tests: 40 },
      { file: 'z', tests: 250 },
      { file: 'w', tests: 5 },
    ];
    expect(planGroups([...entries].reverse(), 285)).toEqual(planGroups(entries, 285));
  });

  it('сумма ровно на потолке остаётся в группе', () => {
    expect(
      planGroups(
        [
          { file: 'a', tests: 200 },
          { file: 'b', tests: 85 },
        ],
        285,
      ),
    ).toEqual([['a', 'b']]);
  });

  it('файл тяжелее потолка идёт группой из одного файла, к ней ничего не добавляется', () => {
    expect(
      planGroups(
        [
          { file: 'a', tests: 10 },
          { file: 'big', tests: 900 },
          { file: 'c', tests: 10 },
        ],
        285,
      ),
    ).toEqual([['big'], ['a', 'c']]);
  });

  it('пустая выборка — ни одной группы', () => {
    expect(planGroups([], 285)).toEqual([]);
  });
});

describe('planCap', () => {
  it('300 → 285: запас 5 % на рост файлов с прошлого прогона', () => {
    expect(planCap(300)).toBe(285);
  });

  it('не опускается ниже одного теста', () => {
    expect(planCap(1)).toBe(1);
  });
});
