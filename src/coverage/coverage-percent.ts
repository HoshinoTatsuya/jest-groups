/**
 * Процент покрытия так, как его считает istanbul (`percent.js`): отсечение до
 * сотых, а не округление; пустая метрика — 100. Иначе на границе порога
 * (89.996 %) раннер и jest отвечали бы по-разному.
 */
export const coveragePercent = (covered: number, total: number): number =>
  total > 0 ? Math.floor((1000 * 100 * covered) / total / 10) / 100 : 100;
