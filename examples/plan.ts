// How a plan is built: per-file test counts (fact or text estimate) packed first-fit decreasing.
import { readFileSync } from 'node:fs';
import { assessTests, loadProjectTypescript, planCap, planGroups } from '@hoshinotatsuya/jest-groups';

const { typescript } = loadProjectTypescript(process.cwd());
const files = ['src/a.spec.ts', 'src/b.spec.ts'];

const entries = files.map((file) => {
  const { tests, certain } = assessTests(typescript, file, readFileSync(file, 'utf8'));
  // A count the text does not prove (tests built by a helper, tables from imports) gets a whole group.
  return { file, tests: certain ? Math.ceil(tests * 1.25) : planCap(300) };
});

const groups: string[][] = planGroups(entries, planCap(300)); // planCap(300) === 285
console.log(groups);
