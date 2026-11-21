import type { TypescriptApi } from './typescript-api.type';

/** Чем раннер оценивает спеки проекта по тексту. */
export interface ProjectTypescript {
  /** JS API для оценки по AST; null — оценка регуляркой. */
  readonly typescript: TypescriptApi | null;
  /**
   * Строка журнала, когда TypeScript в проекте есть, но оценка идёт не им
   * (TypeScript 7 без JS API, сломанная установка); null — сказать нечего.
   */
  readonly note: string | null;
}
