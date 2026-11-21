/** Покрытие файла в форме istanbul `coverage-final.json` (то, что пишет jest). */
export interface FileCoverage {
  readonly path?: string;
  readonly statementMap?: Record<string, { readonly start?: { readonly line: number } }>;
  readonly s?: Record<string, number>;
  readonly f?: Record<string, number>;
  readonly b?: Record<string, number[]>;
  readonly bT?: Record<string, number[]>;
  readonly [extra: string]: unknown;
}
