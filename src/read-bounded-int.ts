/**
 * Целое в пределах `[min, max]` из переменной окружения; пусто — значение по
 * умолчанию. Мусор и значение за пределом — исключение: тихий откат к
 * умолчанию спрятал бы опечатку, а тихое «как попросили» — обход обещания
 * раннера (`JEST_GROUP_WORKERS=16`).
 */
export const readBoundedInt = (
  raw: string | undefined,
  fallback: number,
  name: string,
  limits: { readonly min: number; readonly max: number },
): number => {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} — целое число, получено «${raw}»`);
  }
  if (value < limits.min || value > limits.max) {
    throw new Error(`${name} — от ${limits.min} до ${limits.max}, получено ${value}`);
  }
  return value;
};
