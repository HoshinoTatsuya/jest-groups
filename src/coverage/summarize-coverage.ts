import type { CoverageSummary } from '../types/coverage-summary.type';
import type { FileCoverage } from '../types/file-coverage.type';
import { coveragePercent } from './coverage-percent';

/**
 * Итог покрытия файла — тем же способом, что `FileCoverage.toSummary()`
 * istanbul: строка покрыта, если покрыт хоть один оператор, начинающийся на
 * ней; ветви — по каждому исходу; операторы и функции — по счётчикам.
 */
export const summarizeCoverage = (coverage: FileCoverage): CoverageSummary => {
  const lines = new Map<number, number>();
  for (const [id, count] of Object.entries(coverage.s ?? {})) {
    const line = coverage.statementMap?.[id]?.start?.line;
    if (line !== undefined) {
      lines.set(line, Math.max(lines.get(line) ?? 0, count));
    }
  }
  const simple = (values: readonly number[]) => {
    const covered = values.filter((value) => value > 0).length;
    return { total: values.length, covered, pct: coveragePercent(covered, values.length) };
  };
  return {
    lines: simple([...lines.values()]),
    functions: simple(Object.values(coverage.f ?? {})),
    statements: simple(Object.values(coverage.s ?? {})),
    branches: simple(Object.values(coverage.b ?? {}).flat()),
  };
};
