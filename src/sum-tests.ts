/** Сумма тестов группы по плану. */
export const sumTests = (group: readonly string[], planned: ReadonlyMap<string, number>): number =>
  group.reduce((total, file) => total + (planned.get(file) ?? 0), 0);
