/** Форма плана `--plan-only`: потолок — целое > 0, числа тестов — целые ≥ 0. */
export const isPlan = (value: unknown): value is { max: number; counts: Record<string, number> } => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { max, counts } = value as { max?: unknown; counts?: unknown };
  return (
    Number.isInteger(max) &&
    (max as number) > 0 &&
    typeof counts === 'object' &&
    counts !== null &&
    !Array.isArray(counts) &&
    Object.values(counts).every((tests) => Number.isInteger(tests) && (tests as number) >= 0)
  );
};
