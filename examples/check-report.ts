// The jest-assert-no-skipped check from code: a merged report is accepted only if it is complete.
import { checkReportFile, findSkippedTests, type JestReport } from '@hoshinotatsuya/jest-groups';
import { readFileSync } from 'node:fs';

const { exitCode, lines } = checkReportFile('.jest-report.json', false); // false — a partial report is a failure
for (const line of lines) console.log(line);

const report = JSON.parse(readFileSync('.jest-report.json', 'utf8')) as JestReport;
console.log(`skipped: ${findSkippedTests(report).length}`);
process.exitCode = exitCode; // 0 — green and complete, 1 — failed/skipped/empty, 2 — unreadable report
