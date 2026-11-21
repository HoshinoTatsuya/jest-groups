/**
 * Делит группы так, чтобы аргументы одного запуска (`argLength(файл)` байт на
 * файл плюс `fixed` на общую часть команды) не превышали `budget`. Файл,
 * который не влезает и один, идёт отдельным запуском: короче путь не станет,
 * и отказ ОС тогда — честный ответ про этот файл.
 */
export const splitByArgvBudget = (
  groups: readonly (readonly string[])[],
  budget: number,
  fixed: number,
  argLength: (file: string) => number,
): string[][] => {
  const result: string[][] = [];
  for (const group of groups) {
    let current: string[] = [];
    let used = fixed;
    for (const file of group) {
      const length = argLength(file) + 1;
      if (current.length > 0 && used + length > budget) {
        result.push(current);
        current = [];
        used = fixed;
      }
      current.push(file);
      used += length;
    }
    if (current.length > 0) {
      result.push(current);
    }
  }
  return result;
};
