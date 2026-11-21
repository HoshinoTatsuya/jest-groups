/**
 * Целое больше нуля из переменной окружения; пусто — значение по умолчанию.
 * Мусор — исключение: тихий откат к умолчанию спрятал бы опечатку в CI.
 */
export const readPositiveInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} — целое число больше нуля, получено «${raw}»`);
  }
  return value;
};
