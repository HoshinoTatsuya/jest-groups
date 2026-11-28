# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning
with the pre-1.0 rule that a minor version may break the API (each such version has a
**Migration** section).

## [0.9.0] — 2026-11-28

### Added
- `jest-groups-merge` merges the reports of all CI shards into a report of the whole suite
  (`mergeShardReports` in the API). It refuses (exit 2) when a shard is missing or given twice, the
  shards come from different layouts, tools or shard counts, or a file is listed in two shards;
  when the shards have no partial reason other than the shard itself, the merged report passes
  `jest-assert-no-skipped` without `--allow-partial`. For jest shards it also
  merges coverage and checks the project's `coverageThreshold` on the merged data
  (`--merge-coverage … --coverage … -- <jest command>`; a coverage file given twice is refused).
  Shard reports now carry the layout fingerprint (spec files and their estimated counts, not the
  code version) and their files (`jestGroups.plan`, `jestGroups.files`); an empty
  `--changed-since` shard has an empty layout and merges. Coverage thresholds of sharded vitest
  suites are not supported.
- `vitest-groups --merge-coverage`: every group writes a blob report with coverage and with
  thresholds off, and `vitest run --merge-reports` merges them and checks the config's thresholds
  on the merged coverage with vitest's own text; a merge killed by a ceiling is a runner refusal
  (exit 2), not a threshold failure. Before, coverage merging was refused for vitest.
- `--collect-tests` (jest 30.4+): files without history whose count the text does not prove are
  counted with `jest --collectTests` before the plan instead of getting a whole group each. As in a
  real run the test environment, `setupFiles` and `setupFilesAfterEnv` run and the specs are
  loaded; `globalSetup`, test bodies and hooks do not, and no coverage is collected. Launches stay
  within the command-line budget; skipped with `--dry-run`.
- A watchdog process stops the runner's groups when the runner itself is killed with SIGKILL (until
  now a documented limit: the jest group kept running).

### Fixed
- The default group memory ceiling (`JEST_GROUP_MAX_RSS_MB`) and free-memory threshold
  (`JEST_GROUP_MIN_FREE_MB`) are computed from the cgroup limit when one is set
  (`readMemoryBudget`), not from the host's RAM: in a 4 GB container on a 64 GB host the ceiling
  was 32 GB (the container was OOM-killed first) and the free-memory threshold 6.4 GB (never
  reached, so the runner waited until "machine overloaded"). Under a cgroup limit the default
  free-memory threshold is also at most a quarter of the limit (1 GB in a 1 GB container was never
  reached either).
- A report in which a sampled file ran twice, outside its group or not at all is deleted together
  with JUnit and coverage when the runner refuses (exit 2): with `success: true` it could otherwise
  be merged by `jest-groups-merge` as a complete shard.
- Without TypeScript, a spec file with a test call inside a loop (`for`, `while`, `do`,
  `forEach`/`map`/`flatMap`) is "not proven" for the plan: the regular expression counted a test in
  a loop as one proven test (a file of 7 tests was planned as 2). A loop inside a test body
  (`expect(rows.map(f))`) still counts as proven.
- On macOS, cleanup of a group that holds only zombies (`kill(-pgid)` answers EPERM) no longer
  fails the run with exit 1 instead of 128 + signal.

### Migration
- In a container or CI job with a memory limit the default ceilings are lower than before; set
  `JEST_GROUP_MAX_RSS_MB` / `JEST_GROUP_MIN_FREE_MB` explicitly if a group legitimately needs more.
- `--collectTests` in the jest command is refused (the runner sets it itself with
  `--collect-tests`).
- A refused run (a file ran twice, outside its group or not at all) no longer leaves its report:
  steps that read the report after exit 2 find none.
- Code that compared a shard report's `jestGroups` exactly should expect `plan` and `files`.

## [0.8.1] — 2026-11-28

### Fixed
- The group memory ceiling (`JEST_GROUP_MAX_RSS_MB`) on macOS now counts the physical footprint
  of each process (`footprint`: resident, compressed and swapped pages), taking the larger of it
  and RSS. RSS alone undercounted: under memory pressure macOS compresses pages that are not being
  touched, and a process holding 400 MB showed 36 MB of RSS half a second later (412 MB of
  footprint), so a group could fill compressed memory and swap without reaching the ceiling. If
  `footprint` is missing or does not answer within a second, the sample falls back to RSS. Linux,
  FreeBSD and OpenBSD are unchanged.

## [0.8.0] — 2026-11-28

### Fixed
- A shard report (`--shard i/n` with n > 1) is now marked partial (`jestGroups.partial:
  "shard i/n"`). Before, `jest-assert-no-skipped` accepted the report of one CI machine as a check
  of the whole suite. Several reasons are joined by a comma
  (`changed-since origin/main, shard 1/2`). `--shard 1/1` covers the whole suite: it is not
  partial, and the merged-coverage threshold is now checked for it.

### Migration
- A shard job that runs `jest-assert-no-skipped` now fails with "отчёт частичный (shard i/n)". Pass
  `--allow-partial` there (or `checkReportFile(path, true)`), and check in the pipeline that every
  shard ran and passed.
- Code that read `jestGroups.partial` to recognise `--changed-since` or a resume should expect a
  comma-separated list of reasons.

## [0.7.3] — 2026-11-21

### Changed
- First public release as `@hoshinotatsuya/jest-groups`, MIT; documentation in English and
  Russian; no functional changes.
- The architecture gates used by the package's own specs (development only) raised to `^0.12.2`.
- CI moved to GitHub Actions; README examples live in `examples/` and are type-checked.

## [0.7.2]

### Fixed
- A failure text no longer throws on a value without a prototype or with a throwing `toString`:
  an abort reason, a project TypeScript that throws such a value while loading, or an error with a
  throwing `message` getter now give a readable `JestGroupsError` (exit 2/143) instead of a
  `TypeError` with a stack trace.

## [0.7.1]

### Fixed
- The merged-coverage threshold failure uses the text of the installed jest version (jest 30.4
  changed it); `checkCoverageThreshold` takes the version as an optional fourth argument.

## [0.7.0]

### Added
- TypeScript 7 projects no longer crash the runner: the estimate uses the project's `typescript`
  (5.x, 6.x), otherwise the optional peer `@typescript/typescript6`, otherwise a regular expression
  with a log line. `loadProjectTypescript`, `isTypescriptApi`, `TYPESCRIPT6_PACKAGE`, types
  `TypescriptApi`, `ProjectTypescript`.
- The regular expression sees `xit`, `fit`, `xtest`; the cache remembers which estimator produced
  an estimate. vitest 5.1 verified.

### Migration
- A project on TypeScript 7: `pnpm add -D @typescript/typescript6` for the exact estimate.
- `assessTests`, `estimateTests`, `RunGroupsOptions.typescript` take `TypescriptApi`; passing the
  TypeScript 7 main entry is a `JestGroupsError`.

## [0.6.0]

### Changed
- A changed file is planned with calibration (fact + visible growth × fact/estimate, and growth by
  size); the estimate sees tables from constants of the same file; a file whose count the text does
  not prove runs alone on a cold cache.
- A group whose actual test count exceeds the ceiling fails the run (exit 2) by default.

### Migration
- To keep the old "log line only" behaviour set `JEST_GROUPS_STRICT=0` (`strictCeiling: false`).

## [0.5.2]

### Fixed
- A pid that does not address one process (0, ±1, non-integers) is refused before any signal.

## [0.5.1]

### Changed
- A spec path in the jest command itself is refused before the first group (jest would run it in
  every group).

## [0.5.0]

### Added
- `vitest-groups` and `pytest-groups`; machine gate before each group; group time and memory
  ceilings; duration-based plan ceiling; `--from-group`, `--failed-only`, `--changed-since`,
  `--shard`, `--junit`; `jest-assert-no-skipped --allow-partial`.

### Fixed
- Signals reach the whole process group with escalation to SIGKILL; the cache is per command and
  per file fingerprint; the project's coverage threshold is checked on merged coverage; files in
  several jest projects; snapshot summaries merged correctly.

### Migration
- kebab-case runner flags (`--max-workers=16`, `--run-in-band`, `-w4`) and unknown runner flags are
  refused; `JEST_GROUP_WORKERS` is 1…2 and `JEST_GROUP_MAX_TESTS` 1…300.
- `ProcessRunner` takes a fourth argument (`RunProcessOptions`); `ProcessResult` has `outcome`,
  `peakRssBytes`, `leftovers`. `CACHE_FILE_SEGMENTS` became `CACHE_DIR_SEGMENTS`. New cache format
  (the old one is read as a lower bound).

## [0.4.0]

### Changed
- `exports` map: only declared entries are importable; exported dictionaries are deeply frozen.

## [0.3.0]

### Changed
- The previous report and coverage are deleted before the run; signals during `--listTests` exit
  130/143; flags the runner sets itself are refused in the jest command; exit codes via
  `process.exitCode`.

### Migration
- Remove `--maxWorkers`, `--runInBand`, `--watch`, `--shard`, `--json`, `--outputFile` from the jest
  command.

## [0.2.0]

### Changed
- `runGroups` and `ProcessRunner` are asynchronous; SIGINT/SIGTERM are forwarded; exit codes
  (`EXIT_CODE`); atomic cache writes; first-fit decreasing packing; command-line budget; coverage
  merging (`--merge-coverage`).

### Migration
- Await `runGroups`; a custom `ProcessRunner` returns a `Promise`.

## [0.1.1]

### Fixed
- `jest-assert-no-skipped` also fails an unsuccessful run; the `--out` directory is created.

## [0.1.0]
- First version: sequential jest groups with a merged report.
