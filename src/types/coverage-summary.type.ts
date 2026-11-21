/** Итог покрытия по четырём метрикам — как `FileCoverage.toSummary()` istanbul. */
export interface CoverageSummary {
  readonly statements: { readonly total: number; readonly covered: number; readonly pct: number };
  readonly branches: { readonly total: number; readonly covered: number; readonly pct: number };
  readonly lines: { readonly total: number; readonly covered: number; readonly pct: number };
  readonly functions: { readonly total: number; readonly covered: number; readonly pct: number };
}
