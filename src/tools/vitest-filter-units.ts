import { basename } from 'node:path';

/**
 * Неделимые единицы плана для vitest. Путь файла в команде vitest — не путь, а
 * ФИЛЬТР-подстрока: `vitest run /p/src/a.spec.ts` гонит и `/p/src/data.spec.ts`
 * (относительный путь второго содержит `a.spec.ts`; так в 4.1 устроен
 * `filterFiles`). Файлы, которые фильтр одного захватывает, обязаны идти одной
 * группой — иначе второй выполнится в чужой группе сверх её плана и ещё раз в
 * своей.
 *
 * Захват считается с запасом и без знания `dir` из конфига: любой путь, в
 * котором встречается ИМЯ файла-фильтра (каждое срабатывание vitest — подмножество
 * этого). Лишнее объединение стоит только крупной единицы; пропуск — двойного
 * прогона, который всё равно поймает сверка отчёта («файл вне своей группы»).
 */
export const vitestFilterUnits = (files: readonly string[]): string[][] => {
  const lower = files.map((file) => file.toLowerCase());
  const parent = files.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    parent[index] = root;
    return root;
  };
  for (const [index, file] of files.entries()) {
    const name = basename(file).toLowerCase();
    for (const [other, path] of lower.entries()) {
      if (other !== index && path.includes(name)) {
        parent[find(other)] = find(index);
      }
    }
  }
  const units = new Map<number, string[]>();
  for (const [index, file] of files.entries()) {
    const root = find(index);
    units.set(root, [...(units.get(root) ?? []), file]);
  }
  return [...units.values()].map((unit) => unit.sort());
};
