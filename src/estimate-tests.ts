import { assessTests } from './assess-tests';
import type { TypescriptApi } from './types/typescript-api.type';

/**
 * Оценка числа тестов файла по тексту; не меньше 1 — файл стоит запуска.
 * Доказана ли она текстом — `assessTests`.
 *
 * Точное число известно только после выполнения, поэтому оценка нужна для
 * файла без истории в кэше и для калибровки изменённого. Без TypeScript (его
 * нет в проекте) — подсчёт вызовов регуляркой: грубее, но лучше, чем «один
 * тест на файл».
 */
export const estimateTests = (typescript: TypescriptApi | null, path: string, text: string): number =>
  assessTests(typescript, path, text).tests;
