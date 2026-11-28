# @hoshinotatsuya/jest-groups

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/jest-groups.svg)](https://www.npmjs.com/package/@hoshinotatsuya/jest-groups)
[![CI](https://github.com/HoshinoTatsuya/jest-groups/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/jest-groups/actions/workflows/ci.yml)

[Русская версия](README.ru.md) · [Changelog](CHANGELOG.md)

Runs a jest suite (also vitest and pytest) in **sequential groups**: at most 300 tests per group,
at most 2 workers, the next group starts after the previous one finished, and the results are
merged into one `jest --json` report. One jest process over a whole suite starts a worker per
CPU core; on a developer laptop with a large TypeScript suite that is enough to swap the machine
to a halt in the middle of a commit hook. This runner exists to make that impossible.

Its promises hold without exceptions: the test and worker ceilings can only be lowered by
environment variables, flags that conflict with the group's own flags are refused in any spelling,
stopping kills the whole process group, the runner waits for the machine to be back to normal
before each group, and a group over its time or memory ceiling is killed.

## Install

```sh
pnpm add -D @hoshinotatsuya/jest-groups
```

Optional peers: `typescript` (≥ 5) and, for projects on TypeScript 7, `@typescript/typescript6`
(`>=6.0.0 <7`) — they make the per-file test estimate exact (AST instead of a regular expression).
The runner works without them. `vitest-groups` needs vitest 4 or 5; `pytest-groups` needs pytest
with pytest-xdist.

## Quick start

```json
{
  "scripts": {
    "test": "jest-groups --out .jest-report.json -- node_modules/.bin/jest && jest-assert-no-skipped .jest-report.json",
    "test:db": "jest-groups --out .jest-db.json -- node_modules/.bin/jest --config jest.db.config.js",
    "test:vitest": "vitest-groups --out .vitest-report.json -- node_modules/.bin/vitest && jest-assert-no-skipped .vitest-report.json"
  }
}
```

`pnpm test` prints the plan, runs each group and fails if any group failed, any spec file was not
executed, a group exceeded the ceiling, or the merged report contains skipped tests:

```text
[группы jest] файлов 48, тестов по плану 864, групп 4 (до 300 тестов, по плану до 285, воркеров 2, последовательно)
[группа 1, 1/4] файлов 4, тестов 285 (план 285) — ок за 1 с, память до 156 МБ
```

Select specs with jest's own options after `--` (`--testPathPatterns`, `--config`, `--selectProjects`);
do **not** pass a spec path positionally — jest would run it in every group (refused before start).

## CLI

| Command | What it does |
|---|---|
| `jest-groups --out <report.json> [flags] -- <jest command>` | sample via `--listTests`, pack into groups, run them one by one, write a merged report in the `jest --json` shape |
| `vitest-groups --out <report.json> [flags] -- <vitest command>` | the same for vitest 4 and 5: sample `vitest list --filesOnly --json`, each group `vitest run <files>`; do not put a subcommand in the command |
| `pytest-groups --out <report.json> [flags] -- <pytest command>` | the same for pytest with pytest-xdist: sample `--collect-only -q` (exact counts per file), each group `pytest <files> -n <workers>`, the JUnit report is read in the jest shape; select with `-k`/`-m`/`testpaths`, not paths |
| `jest-groups --plan-only <plan.json>` | pack `{max, counts}` without running anything — for gates |
| `jest-assert-no-skipped [--allow-partial] <report.json>` | exit 1 if the run did not succeed, has skipped tests, has no tests at all or is partial (without `--allow-partial`) |

Runner flags (before `--`; an unknown flag is refused):

| Flag | Effect |
|---|---|
| `--out <file>` | merged report (required) |
| `--dry-run` | print the plan and exit |
| `--merge-coverage <coverage-final.json>` | merge the groups' coverage into one file and check the project's `coverageThreshold` on the merged data (jest only) |
| `--junit <file.xml>` | JUnit XML over all groups |
| `--changed-since <ref>` | only what changed against a git ref; nothing changed — exit 0 and an empty partial report |
| `--shard <i>/<n>` | CI shard: files are split by the text estimate (identical on every machine); the plan fingerprint is logged |
| `--from-group <N>` | resume the previous full run of this command from group N (same plan) |
| `--failed-only` | resume: only failed and not-started groups of the previous run |

A resumed, `--changed-since` or shard report (`--shard i/n` with n > 1) is marked partial
(`jestGroups.partial`, reasons joined by a comma, e.g. `changed-since origin/main, shard 1/2`):
`jest-assert-no-skipped` rejects it without `--allow-partial`, so a fast run or one CI machine never
looks like a check of the whole suite. On a shard job pass `--allow-partial`; that every shard of
the pipeline ran and passed is the pipeline's job to check.

## Environment variables

| Variable | Default | Limits | Meaning |
|---|---|---|---|
| `JEST_GROUP_MAX_TESTS` | 300 | 1…300 | ceiling of tests per group (a fact); the plan keeps groups at 285 |
| `JEST_GROUP_WORKERS` | 2 | 1…2 | workers per group |
| `JEST_GROUPS_KEEP_GOING=1` | — | — | do not stop at the first failed group |
| `JEST_GROUPS_STRICT` | 1 | 0…1 | 1 — a group whose actual test count exceeds the ceiling fails the run (exit 2) after all groups; 0 — a log line only |
| `JEST_GROUP_TIMEOUT_S` | 1800 | 1…14400 | time ceiling of a group: longer — killed, exit 2 |
| `JEST_GROUP_KILL_GRACE_S` | 10 | 1…120 | wait after SIGTERM before SIGKILL of the whole group |
| `JEST_GROUP_MAX_RSS_MB` | ½ of RAM | 64…RAM | ceiling of the summed RSS of the group's processes: above — killed, exit 2 |
| `JEST_GROUP_MIN_FREE_MB` | max(1024, 10 % of RAM) | 0… | wait for this much free memory before each group |
| `JEST_GROUP_MAX_LOAD_PERCENT` | 150 | 10…1000 | wait until the 1-minute load average per core is at most this % |
| `JEST_GROUP_MACHINE_WAIT_S` | 600 | 1…3600 | how long to wait for the machine: longer — refused "machine overloaded" |
| `JEST_GROUP_MAX_SECONDS` | none | 1…14400 | second plan ceiling by expected group duration (from the duration cache) |
| `JEST_GROUP_ARGV_BUDGET` | 7 000 (Windows) / 256 KB | 1…default | ceiling of the command-line length of one launch |

A value outside its limits is a refusal (exit 2), never "as requested": raising the test or worker
ceiling is exactly what the runner exists to prevent.

Free memory on macOS is `kern.memorystatus_level` (`os.freemem()` counts only empty pages there),
on Linux the lesser of `MemAvailable` and the cgroup limit. Group memory is the summed RSS of its
process group (`/proc` on Linux, `ps` on macOS); on Windows the memory ceiling does not apply and
the runner says so on start. The machine thresholds are a conservative assumption, not a
measurement of your machine — tune them.

## Refusals

Not green:
- the sample is empty (except with `--changed-since`);
- a group failed (later groups are not started unless `KEEP_GOING`) — exit 1;
- the coverage threshold is not met on the merged coverage — exit 1, with jest's own text;
- a sampled file is missing from every report, ran in two groups, ran more often than it has jest
  projects, or ran in a group that is not its own;
- coverage is enabled by config (`collectCoverage`) without `--merge-coverage`;
- a group was killed by its time or memory ceiling, or the machine did not recover — exit 2;
- the actual test count of a group exceeds the ceiling — exit 2 after all groups (exit 1 if tests
  also failed); `JEST_GROUPS_STRICT=0` turns it into a log line;
- a resume whose group under the current plan is over the ceiling — before start;
- a flag the runner sets itself, in any spelling: `--maxWorkers`/`--max-workers`/`-w4`,
  `--runInBand`/`-i` and groups like `-bi`, `--watch`/`--watchAll`, `--shard`, `--json`,
  `--outputFile` (vitest: also subcommands, `--reporter`, `--outputFile.*`, `--poolOptions.*`;
  pytest: `-n`/`--numprocesses`, `--junitxml`, `--looponfail`/`-f`, `--collect-only`, also in
  `PYTEST_ADDOPTS`).

Exit codes (`EXIT_CODE`): 0 — clean, 1 — tests or coverage threshold failed, 2 — runner refusal,
129/130/143 — SIGHUP/SIGINT/SIGTERM.

## Stopping and processes

Every group (and the sample) runs in its own process group. SIGINT, SIGTERM or SIGHUP to the runner
sends SIGTERM to the whole group (wrapper, jest, workers) and SIGKILL after
`JEST_GROUP_KILL_GRACE_S`; a second signal sends SIGKILL at once. Later groups are not started, the
cache with the facts of finished groups is saved, no report is written, the exit code is
128 + signal. Processes left in the group after jest exits (a test did not close a server) are
killed and named in the log. A process that moved to its own session (`setsid`, `detached`) is out
of reach, but the runner does not wait for it. If the runner itself is killed with SIGKILL, the jest
group keeps running — SIGKILL cannot be intercepted. A pid that does not address exactly one
process (0, ±1, non-integers) is refused before any `kill()`.

On Windows there are no POSIX groups: the tree is killed with `taskkill /T /F`, leftovers are not
searched; `.cmd`/`.bat` command lines are built with `^` before each cmd.exe metacharacter — the
produced strings are tested, a real Windows run is not.

## Planning and the cache

`node_modules/.cache/jest-test-groups/<tool>-<command hash>.json` keeps, per spec file, the last
actual test count, the file's fingerprint (mtime, size), its duration and the text estimate of the
same content. Every sample command has its own cache. **The ceiling limits the fact; a cached
number is the past**, so a changed file is planned conservatively:

| file | count used by the plan |
|---|---|
| unchanged fingerprint | the fact |
| changed | the largest of: the fact; fact + growth of visible tests × (fact / estimate of the same content, at least 1); fact × (new size / old size) if it grew. A merely touched file keeps its fact |
| no history, the text proves the count | estimate × 1.25 |
| no history, the text does not prove it | a full plan group (285): the file runs alone |

The text estimate (`assessTests`) uses the project's TypeScript AST: `it`/`test` calls, `.each`
tables, `for…of`/`forEach`/`map` over a literal or a constant of the same file. Tests under a loop of
unknown length or built by a helper are "not proven". On TypeScript 7 install
`@typescript/typescript6` for the AST; otherwise a regular expression is used and the runner logs
it. After each group its real count is compared with the ceiling and the facts go to the cache, so
the next plan is right; the run finishes and only then refuses (one re-run is enough). A single spec
file larger than the ceiling is refused every time — the runner does not split files.

**CI with a fresh clone** has no history: keep `node_modules/.cache/jest-test-groups` between jobs
(e.g. `actions/cache` keyed by branch), otherwise every run plans blind.

## Coverage

`--merge-coverage <coverage-final.json>`: each group writes its own coverage
(`--coverageReporters=json`), the threshold is lifted inside groups (`--coverageThreshold={}`), and
the runner merges the counters and checks the project's `coverageThreshold` on the merged data with
jest 30 semantics (`global`, path, glob, negative thresholds) and jest's own failure text (the text
of the installed jest version, 30.4+ changed it). Without this, the first group would fail
"threshold not met: 25 %" on a suite with 100 %. The threshold is not checked for partial runs.
vitest coverage merging is not supported (refused).

## Programmatic API

The CLI is a thin wrapper over `runGroups`. The process port (`ProcessRunner`) and the machine gate
(`MachineGate`) are injected, so the orchestration is testable without real processes or clocks.

<!-- example: examples/run-groups.ts -->
```ts
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
```

`RunGroupsOptions` also takes `tool` (`'jest'` default, `'vitest'`, `'pytest'`), `argvBudgetBytes`,
`mergeCoverageTo`, `junitTo`, `strictCeiling` (default `true`), `changedSince`, `shard`
(`{index, count}`, from 1), `resume` (`{fromGroup?, failedOnly?}`) and `limits.maxRssBytes`,
`limits.maxDurationMs`. Failures are `JestGroupsError` with `exitCode`.

<!-- example: examples/plan.ts -->
```ts
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
```

<!-- example: examples/check-report.ts -->
```ts
// The jest-assert-no-skipped check from code: a merged report is accepted only if it is complete.
import { checkReportFile, findSkippedTests, type JestReport } from '@hoshinotatsuya/jest-groups';
import { readFileSync } from 'node:fs';

const { exitCode, lines } = checkReportFile('.jest-report.json', false); // false — a partial report is a failure
for (const line of lines) console.log(line);

const report = JSON.parse(readFileSync('.jest-report.json', 'utf8')) as JestReport;
console.log(`skipped: ${findSkippedTests(report).length}`);
process.exitCode = exitCode; // 0 — green and complete, 1 — failed/skipped/empty, 2 — unreadable report
```

Other exports:

| Export | Purpose |
|---|---|
| `planGroups(entries, max, maxDurationMs?)`, `planCap(max, headroom = 0.05)`, `assignShard`, `splitByArgvBudget` | packing (first-fit decreasing, deterministic), plan ceiling, CI shards, command-line budget |
| `assessTests(ts, path, text)` → `{tests, certain}`, `estimateTests` | text estimate of a spec file |
| `loadProjectTypescript(cwd)` → `{typescript, note}`, `isTypescriptApi`, `TYPESCRIPT6_PACKAGE` | which compiler estimates the project's specs |
| `mergeReports`, `mergeCoverage(reports, {platform?})`, `checkCoverageThreshold`, `summarizeCoverage`, `toJunitXml` | merging reports and coverage |
| `findSkippedTests`, `findRunFailures`, `checkReportFile(path, allowPartial)`, `parseListTestsOutput` | report checks |
| `waitForMachine(gate, log, signal?)`, `readMachineLoad(platform?)` | the machine gate |
| `spawnProcess`, `signalProcessGroup` | the real process port |
| `readBoundedInt`, `readPositiveInt` | bounded environment parsing |
| `ENV_NAMES`, `ENV_LIMITS`, `GROUP_DEFAULTS`, `EXIT_CODE`, `PROCESS_OUTCOME`, `TOOL_NAME`, `CACHE_DIR_SEGMENTS` | deeply frozen dictionaries |

Only the entries of the `exports` map (`.` and `./package.json`) are importable.

## Guarantees and limits

- The price of grouping is **one jest start per group** (~0.5 s for plain JS, plus the transform
  warm-up for TypeScript): a suite of N tests pays it ⌈N / 285⌉ times. The jest transform cache
  (`cacheDirectory` outside a temp dir) is the only thing that reduces it. Planning itself is cheap:
  50 000 files plan in 2.6 s.
- A file whose tests are generated by code the estimate cannot see may exceed the ceiling once on a
  cold cache; after that the plan knows its fact. With `JEST_GROUPS_STRICT=1` (default) that run
  exits 2.
- A process that left the group's session, and the group of a runner killed by SIGKILL, are out of
  reach.
- Windows: memory ceiling not applied; command-line escaping is verified on produced strings, not on
  a real Windows machine.
- `--changed-since` and coverage merging are not supported for pytest; coverage merging is not
  supported for vitest.
- **Log lines and failure messages are in Russian.**

## Failure behaviour

Fail-closed: an out-of-range variable, an unknown flag, an unreadable or truncated group report, a
file that did not run or ran twice, an empty sample, an overloaded machine — exit 2 with the reason,
never a green run. The previous report and coverage are deleted before the run, so a run that stops
early never leaves a stale green report for `jest-assert-no-skipped` to read. A thrown value without
a prototype or with a throwing `toString` still produces a readable refusal.

## Compatibility

- Node.js ≥ 24.
- jest 30 (verified with 30.5.2), vitest 4.1 and 5.1, pytest 9.2 + pytest-xdist 3.8.
- TypeScript estimate: 5.9, 6.0, 7.0 with `@typescript/typescript6` (7.0 without it — regex).
- Linux and macOS process groups; Windows via `taskkill` (see limits).

## Testing and development

```sh
pnpm install
python3 -m venv .venv && .venv/bin/pip install -r requirements-pytest.txt   # for the pytest-groups spec
pnpm run typecheck   # tsc, examples/*.ts against the real API, README quotes equal examples
pnpm run lint        # biome
pnpm test            # build + the suite through the freshly built jest-groups itself
```

The CLI specs run the built `dist/bin/*.js` against a fake jest (also behind a shell wrapper without
`exec`), against real jest 30, vitest 4.1 and 5.1 in temporary projects, and against TypeScript
5.9, 6.0 and 7.0. Without the Python venv the pytest spec fails with this instruction (it is not
skipped). No Docker or databases are needed.

## License

[MIT](LICENSE) © 2026 Hoshino Tatsuya
