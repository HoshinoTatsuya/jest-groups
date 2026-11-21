import { matchesGlob, resolve, sep } from 'node:path';

import type { CoverageSummary } from '../types/coverage-summary.type';
import type { FileCoverage } from '../types/file-coverage.type';
import { addSummaries } from './add-summaries';
import { percentThresholdFailure } from './percent-threshold-failure';
import { summarizeCoverage } from './summarize-coverage';

/**
 * Порог покрытия по СЛИТОМУ покрытию — с той же семантикой и тем же текстом
 * отказа, что у jest (`CoverageReporter._checkThreshold`, jest 30; текст
 * процентного порога — по `jestVersion`, см. `percentThresholdFailure`): группы
 * `global`, путь (каталог или файл, от корня проекта) и glob (порог КАЖДОМУ
 * файлу); положительное число — процент, отрицательное — потолок непокрытых.
 * Файл, попавший в путь или glob, в `global` не считается. Порог в группах
 * раннер снимает: каждая видела бы свою часть покрытия и падала ложно
 * («90% not met: 25%» при 100 % у полного набора), а остальные группы не
 * запускались. Пустой ответ — порог выполнен.
 */
export const checkCoverageThreshold = (
  coverage: Readonly<Record<string, FileCoverage>>,
  thresholds: Readonly<Record<string, Readonly<Record<string, number>>>>,
  root: string,
  jestVersion: string | null = null,
): string[] => {
  const check = (name: string, limits: Readonly<Record<string, number>>, actual: CoverageSummary): string[] =>
    (['statements', 'branches', 'lines', 'functions'] as const).flatMap((key) => {
      const threshold = limits[key];
      if (threshold === undefined) {
        return [];
      }
      const uncovered = actual[key].total - actual[key].covered;
      if (threshold < 0) {
        return -threshold < uncovered
          ? [`Jest: Uncovered count for ${key} (${uncovered}) exceeds ${name} threshold (${-threshold})`]
          : [];
      }
      return actual[key].pct < threshold
        ? [percentThresholdFailure(name, key, threshold, actual[key].pct, jestVersion)]
        : [];
    });
  const groups = Object.keys(thresholds);
  const kinds = new Map<string, 'path' | 'glob' | 'global'>();
  const members = new Map<string, string[]>();
  const join = (group: string, file: string): void => {
    members.set(group, [...(members.get(group) ?? []), file]);
  };
  for (const file of Object.keys(coverage)) {
    let matched = false;
    for (const group of groups) {
      const resolved = resolve(root, group);
      const absolute = `${resolved}${group.endsWith(sep) && !resolved.endsWith(sep) ? sep : ''}`;
      if (file.startsWith(absolute)) {
        kinds.set(group, 'path');
        join(group, file);
        matched = true;
      } else if (matchesGlob(file, absolute)) {
        kinds.set(group, 'glob');
        join(group, file);
        matched = true;
      }
    }
    if (!matched && groups.includes('global')) {
      kinds.set('global', 'global');
      join('global', file);
    }
  }
  const summary = (files: readonly string[]): CoverageSummary | undefined =>
    files
      .map((file) => summarizeCoverage(coverage[file] ?? {}))
      .reduce<CoverageSummary | undefined>(
        (total, next) => (total === undefined ? next : addSummaries(total, next)),
        undefined,
      );
  const errors: string[] = [];
  for (const group of groups) {
    const limits = thresholds[group] ?? {};
    const files = members.get(group) ?? [];
    const kind = kinds.get(group);
    if (kind === 'glob') {
      for (const file of files) {
        errors.push(...check(file, limits, summarizeCoverage(coverage[file] ?? {})));
      }
    } else if (kind !== undefined) {
      const total = summary(files);
      if (total !== undefined) {
        errors.push(...check(group, limits, total));
      }
    } else if (group !== 'global') {
      errors.push(`Jest: Coverage data for ${group} was not found.`);
    }
  }
  return errors;
};
