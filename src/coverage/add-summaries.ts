import type { CoverageSummary } from '../types/coverage-summary.type';
import { coveragePercent } from './coverage-percent';

/** Сумма итогов (как `CoverageSummary.merge` istanbul): итоги складываются, проценты пересчитываются. */
export const addSummaries = (left: CoverageSummary, right: CoverageSummary): CoverageSummary => {
  const add = (key: keyof CoverageSummary) => {
    const total = left[key].total + right[key].total;
    const covered = left[key].covered + right[key].covered;
    return { total, covered, pct: coveragePercent(covered, total) };
  };
  return {
    statements: add('statements'),
    branches: add('branches'),
    lines: add('lines'),
    functions: add('functions'),
  };
};
