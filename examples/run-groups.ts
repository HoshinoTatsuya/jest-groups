// scripts/test-in-groups.ts — the CLI's orchestration from code: same plan, same limits, same report.
import { freemem } from 'node:os';
import {
  EXIT_CODE,
  GROUP_DEFAULTS,
  JestGroupsError,
  loadProjectTypescript,
  readMachineLoad,
  runGroups,
  spawnProcess,
} from '@hoshinotatsuya/jest-groups';

const cwd = process.cwd();
const project = loadProjectTypescript(cwd); // TypeScript 5.x/6.x, or @typescript/typescript6 next to TypeScript 7
if (project.note !== null) console.log(project.note);

const controller = new AbortController();
process.once('SIGINT', () => controller.abort('SIGINT'));

runGroups({
  command: ['node_modules/.bin/jest', '--config', 'jest.config.js'],
  out: '.jest-report.json',
  cwd,
  maxTests: GROUP_DEFAULTS.MAX_TESTS, // 300 — a ceiling of the FACT, the plan keeps groups at 285
  workers: GROUP_DEFAULTS.WORKERS, // 2
  keepGoing: false,
  dryRun: false,
  run: spawnProcess, // the real process port; tests pass a fake one
  log: (line) => console.log(line),
  typescript: project.typescript,
  signal: controller.signal,
  limits: { timeoutMs: 30 * 60_000, killGraceMs: 10_000 },
  machine: {
    minFreeBytes: Math.max(1024 * 1024 * 1024, freemem() / 10),
    maxLoadPercent: GROUP_DEFAULTS.MAX_LOAD_PERCENT,
    maxWaitMs: 10 * 60_000,
    pollMs: 2_000,
    probe: () => readMachineLoad(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  },
}).catch((error: unknown) => {
  // 1 — tests failed, 2 — the runner refused (empty sample, group over the ceiling…), 128+N — signal.
  process.exitCode = error instanceof JestGroupsError ? error.exitCode : EXIT_CODE.runner;
  console.error(error instanceof Error ? error.message : error);
});
