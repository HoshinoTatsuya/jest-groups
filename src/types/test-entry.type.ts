/** Файл выборки и число тестов в нём: факт из кэша или оценка по тексту. */
export interface TestEntry {
  readonly file: string;
  readonly tests: number;
  /** Ожидаемое время файла, мс (из кэша); нет — неизвестно. */
  readonly durationMs?: number;
}
