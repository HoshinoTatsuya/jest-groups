import { readFileSync } from 'node:fs';

import { JestGroupsError } from '../jest-groups.error';
import { planCap } from '../plan-cap';
import { planGroups } from '../plan-groups';
import { isPlan } from './is-plan';

/**
 * План гейта. Отказ чтения или разбора называет ФАЙЛ: прежде битый JSON давал
 * голое «Unexpected token…» без пути, а план без `counts` — TypeError про
 * `Object.keys` вместо «план не той формы».
 */
export const planOnly = (planPath: string): void => {
  let plan: unknown;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (error) {
    throw new JestGroupsError(
      `--plan-only: план ${planPath} не прочитан: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isPlan(plan)) {
    throw new JestGroupsError(
      `--plan-only: план ${planPath} не той формы — нужен { "max": целое > 0, "counts": { "файл": целое ≥ 0 } }`,
    );
  }
  const { max, counts } = plan;
  const entries = Object.keys(counts)
    .sort()
    .map((file) => ({ file, tests: counts[file] ?? 0 }));
  // Тот же запас, что у боевого прогона: иначе план разошёлся бы с фактом.
  process.stdout.write(`${JSON.stringify(planGroups(entries, planCap(max)))}\n`);
};
