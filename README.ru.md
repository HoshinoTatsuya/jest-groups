# @hoshinotatsuya/jest-groups

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/jest-groups.svg)](https://www.npmjs.com/package/@hoshinotatsuya/jest-groups)
[![CI](https://github.com/HoshinoTatsuya/jest-groups/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/jest-groups/actions/workflows/ci.yml)

[English version](README.md) · [Changelog](CHANGELOG.md)

Запуск набора jest (а также vitest и pytest) **последовательными группами**: не больше 300 тестов
в группе, не больше 2 воркеров, следующая группа стартует после предыдущей, результаты сливаются
в один отчёт формы `jest --json`. Один процесс jest на весь набор поднимает воркер на каждое ядро;
на ноутбуке разработчика с большим набором на TypeScript этого хватает, чтобы машина ушла в своп
посреди хука коммита. Раннер существует, чтобы это стало невозможным.

Обещания раннера держатся без исключений: потолок тестов и воркеров переменными только
понижается, флаги, спорящие с флагами группы, — отказ в любом написании, остановка снимает всю
группу процессов, перед группой раннер ждёт нормы машины, группа сверх потолка времени или памяти
снимается.

## Установка

```sh
pnpm add -D @hoshinotatsuya/jest-groups
```

Необязательные peer: `typescript` (≥ 5) и для проектов на TypeScript 7 — `@typescript/typescript6`
(`>=6.0.0 <7`): с ними оценка числа тестов файла точная (AST вместо регулярки). Без них раннер
работает. `vitest-groups` нужен vitest 4 или 5; `pytest-groups` — pytest с pytest-xdist.

## Быстрый старт

```json
{
  "scripts": {
    "test": "jest-groups --out .jest-report.json -- node_modules/.bin/jest && jest-assert-no-skipped .jest-report.json",
    "test:db": "jest-groups --out .jest-db.json -- node_modules/.bin/jest --config jest.db.config.js",
    "test:vitest": "vitest-groups --out .vitest-report.json -- node_modules/.bin/vitest && jest-assert-no-skipped .vitest-report.json"
  }
}
```

`pnpm test` печатает план, гонит группы по очереди и отказывает, если упала группа, файл спеки не
выполнен, группа превысила потолок или в слитом отчёте есть пропущенные тесты:

```text
[группы jest] файлов 48, тестов по плану 864, групп 4 (до 300 тестов, по плану до 285, воркеров 2, последовательно)
[группа 1, 1/4] файлов 4, тестов 285 (план 285) — ок за 1 с, память до 156 МБ
```

Выборку задавайте ключами jest после `--` (`--testPathPatterns`, `--config`, `--selectProjects`);
путь спеки позиционным аргументом **не** передавайте — jest прогнал бы его в каждой группе (отказ до
запуска).

## CLI

| Команда | Что делает |
|---|---|
| `jest-groups --out <отчёт.json> [флаги] -- <команда jest>` | выборка через `--listTests`, раскладка в группы, прогон по очереди, слитый отчёт формы `jest --json` |
| `vitest-groups --out <отчёт.json> [флаги] -- <команда vitest>` | то же для vitest 4 и 5: выборка `vitest list --filesOnly --json`, группа `vitest run <файлы>`; подкоманду в команду не писать |
| `pytest-groups --out <отчёт.json> [флаги] -- <команда pytest>` | то же для pytest с pytest-xdist: выборка `--collect-only -q` (число тестов файла точное), группа `pytest <файлы> -n <воркеры>`, отчёт JUnit читается в форме jest; выборку — `-k`/`-m`/`testpaths`, не путями |
| `jest-groups --plan-only <план.json>` | раскладка `{max, counts}` без запуска — для гейтов |
| `jest-assert-no-skipped [--allow-partial] <отчёт.json>` | код 1, если прогон не успешен, есть пропущенные тесты, тестов нет вовсе или отчёт частичный (без `--allow-partial`) |

Флаги раннера (до `--`; неизвестный — отказ):

| Флаг | Что делает |
|---|---|
| `--out <файл>` | слитый отчёт (обязателен) |
| `--dry-run` | напечатать план и выйти |
| `--merge-coverage <coverage-final.json>` | слить покрытие групп в один файл и сверить `coverageThreshold` проекта по слитому (только jest) |
| `--junit <файл.xml>` | JUnit XML по всем группам |
| `--changed-since <ref>` | только изменённое относительно ссылки git; изменённых нет — код 0 и пустой частичный отчёт |
| `--shard <i>/<n>` | шард CI: файлы делятся по оценке из текста (одинаковой на всех машинах), отпечаток плана — в журнале |
| `--from-group <N>` | возобновить прошлый полный прогон этой команды с группы N (тот же план) |
| `--failed-only` | возобновить: только упавшие и не запускавшиеся группы прошлого прогона |

Отчёт возобновления, `--changed-since` и шарда (`--shard i/n` при n > 1) помечен частичным
(`jestGroups.partial`, причины через запятую, например `changed-since origin/main, shard 1/2`):
`jest-assert-no-skipped` без `--allow-partial` его не принимает — быстрый прогон или одна машина CI
не выглядят проверкой всего набора. В джобе шарда передайте `--allow-partial`; что отработали и
прошли все шарды пайплайна, проверяет сам пайплайн.

## Переменные

| Переменная | По умолчанию | Пределы | Что |
|---|---|---|---|
| `JEST_GROUP_MAX_TESTS` | 300 | 1…300 | потолок тестов группы (факт); план держит до 285 |
| `JEST_GROUP_WORKERS` | 2 | 1…2 | воркеров в группе |
| `JEST_GROUPS_KEEP_GOING=1` | — | — | не останавливаться на первой упавшей группе |
| `JEST_GROUPS_STRICT` | 1 | 0…1 | 1 — факт группы сверх потолка — отказ (код 2) после всех групп; 0 — только строка в журнале |
| `JEST_GROUP_TIMEOUT_S` | 1800 | 1…14400 | потолок времени группы: дольше — снимается, код 2 |
| `JEST_GROUP_KILL_GRACE_S` | 10 | 1…120 | ожидание после SIGTERM до SIGKILL всей группы |
| `JEST_GROUP_MAX_RSS_MB` | ½ памяти | 64…память | потолок суммарной памяти процессов группы: больше — снимается, код 2 |
| `JEST_GROUP_MIN_FREE_MB` | max(1024, 10 % памяти) | 0… | перед группой ждать столько свободной памяти |
| `JEST_GROUP_MAX_LOAD_PERCENT` | 150 | 10…1000 | перед группой ждать load average за минуту не выше этого % на ядро |
| `JEST_GROUP_MACHINE_WAIT_S` | 600 | 1…3600 | сколько ждать нормы машины: дольше — отказ «машина перегружена» |
| `JEST_GROUP_MAX_SECONDS` | нет | 1…14400 | второй потолок плана — по ожидаемому времени группы (кэш времени файлов) |
| `JEST_GROUP_ARGV_BUDGET` | 7 000 (Windows) / 256 КБ | 1…умолчание | потолок длины аргументов одного запуска |

Значение вне пределов — отказ (код 2), а не «как попросили»: поднять потолок тестов или воркеров
нельзя — ровно от этого раннер и существует.

Свободная память на macOS — `kern.memorystatus_level` (`os.freemem()` там считает только пустые
страницы), на Linux — меньшее из `MemAvailable` и предела cgroup. Память группы — сумма RSS
процессов её группы (`/proc` на Linux, `ps` на macOS); на Windows потолок памяти не действует, и
раннер говорит об этом на старте. Пороги нормы машины — консервативное предположение, а не замер
вашей машины: поправьте их под неё.

## Отказы

Не «зелёный»:
- выборка пуста (кроме `--changed-since`);
- упала группа (следующие не запускаются без `KEEP_GOING`) — код 1;
- порог покрытия не выполнен на слитом покрытии — код 1, текстом самого jest;
- файл выборки не попал ни в один отчёт, выполнен в двух группах, чаще, чем у него проектов jest,
  или не в своей группе;
- покрытие включено конфигом (`collectCoverage`) без `--merge-coverage`;
- группа снята по потолку времени или памяти, машина не пришла в норму — код 2;
- ФАКТ тестов группы больше потолка — код 2 после всех групп (код 1, если ещё и упали тесты);
  `JEST_GROUPS_STRICT=0` — только строка;
- возобновление, группа которого по нынешнему плану больше потолка, — до запуска;
- флаг, который раннер задаёт группе сам, в любом написании: `--maxWorkers`/`--max-workers`/`-w4`,
  `--runInBand`/`-i` и группы вида `-bi`, `--watch`/`--watchAll`, `--shard`, `--json`,
  `--outputFile` (у vitest — ещё подкоманды, `--reporter`, `--outputFile.*`, `--poolOptions.*`; у
  pytest — `-n`/`--numprocesses`, `--junitxml`, `--looponfail`/`-f`, `--collect-only`, в том числе в
  `PYTEST_ADDOPTS`).

Коды выхода (`EXIT_CODE`): 0 — чисто, 1 — упали тесты или порог покрытия, 2 — отказ раннера,
129/130/143 — SIGHUP/SIGINT/SIGTERM.

## Остановка и процессы

Каждая группа (и выборка) — своя группа процессов. SIGINT, SIGTERM, SIGHUP раннеру — SIGTERM всей
группе (обёртке, jest, воркерам), через `JEST_GROUP_KILL_GRACE_S` — SIGKILL; второй сигнал —
SIGKILL сразу. Следующие группы не запускаются, кэш с фактами завершённых групп сохраняется, отчёт
не пишется, код 128 + сигнал. Процессы, оставшиеся в группе после выхода jest (тест не закрыл
сервер), снимаются и названы в журнале. Процесс, сам ушедший в свою сессию (`setsid`, `detached`),
раннеру недоступен — но раннер его не ждёт. Если раннер убит SIGKILL, группа jest продолжит работу:
перехватить SIGKILL нельзя. pid, который не адресует ровно один процесс (0, ±1, не целое), —
отказ до любого `kill()`.

На Windows групп POSIX нет: дерево снимается `taskkill /T /F`, остатки не ищутся; строка `.cmd`/
`.bat` собирается с `^` перед каждым метасимволом cmd.exe — проверены выходные строки, а не запуск
на настоящем Windows.

## План и кэш

`node_modules/.cache/jest-test-groups/<инструмент>-<хэш команды>.json` хранит на файл спеки
последний факт числа тестов, отпечаток файла (mtime, размер), время и оценку по тексту того же
содержимого. У каждой команды выборки свой кэш. **Потолок — предел ФАКТА, а число из кэша —
прошлое**, поэтому изменённый файл планируется с запасом:

| файл | число для плана |
|---|---|
| отпечаток тот же | факт |
| изменён | большее из: факта; факта + прирост видимых тестов × (факт / оценка того же содержимого, не меньше 1); факта × (новый размер / прежний), если файл вырос. Только тронутый файл — факт |
| истории нет, текст число доказывает | оценка × 1.25 |
| истории нет, текст число НЕ доказывает | полная группа плана (285): файл идёт один |

Оценка по тексту (`assessTests`) — AST TypeScript проекта: вызовы `it`/`test`, таблицы `.each`,
`for…of`/`forEach`/`map` по литералу или константе того же файла. Тесты под повтором неизвестной
длины или построенные помощником — «не доказано». На TypeScript 7 для AST поставьте
`@typescript/typescript6`; иначе оценка регуляркой и строка об этом в журнале. После каждой группы
её факт сверяется с потолком и ложится в кэш — следующий план верен; прогон идёт до конца и только
потом отказывает (хватает одного повторного прогона). Файл спеки, который сам больше потолка, —
отказ на каждом прогоне: раннер файлы не делит.

**CI с чистым клоном** не имеет истории: сохраняйте `node_modules/.cache/jest-test-groups` между
джобами (например, `actions/cache` с ключом по ветке), иначе каждый прогон планирует вслепую.

## Покрытие

`--merge-coverage <coverage-final.json>`: каждая группа пишет своё покрытие
(`--coverageReporters=json`), порог в группах снят (`--coverageThreshold={}`), раннер сливает
счётчики и сверяет `coverageThreshold` проекта по слитому с семантикой jest 30 (`global`, путь,
glob, отрицательный порог) и текстом отказа установленной версии jest (с 30.4 текст сменился).
Без этого первая группа падала бы «порог не выполнен: 25 %» на наборе со 100 %. Для частичного
прогона порог не сверяется. Слияние покрытия vitest не поддержано (отказ).

## Программный API

CLI — тонкая обёртка над `runGroups`. Порт запуска процесса (`ProcessRunner`) и норма машины
(`MachineGate`) передаются снаружи — оркестровка проверяется без настоящих процессов и часов.

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

`RunGroupsOptions` принимает также `tool` (`'jest'` по умолчанию, `'vitest'`, `'pytest'`),
`argvBudgetBytes`, `mergeCoverageTo`, `junitTo`, `strictCeiling` (по умолчанию `true`),
`changedSince`, `shard` (`{index, count}`, с 1), `resume` (`{fromGroup?, failedOnly?}`),
`limits.maxRssBytes`, `limits.maxDurationMs`. Отказы — `JestGroupsError` с `exitCode`.

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

Прочие экспорты:

| Экспорт | Назначение |
|---|---|
| `planGroups(entries, max, maxDurationMs?)`, `planCap(max, headroom = 0.05)`, `assignShard`, `splitByArgvBudget` | раскладка (first-fit decreasing, детерминированно), потолок плана, шарды CI, потолок длины аргументов |
| `assessTests(ts, path, text)` → `{tests, certain}`, `estimateTests` | оценка файла спеки по тексту |
| `loadProjectTypescript(cwd)` → `{typescript, note}`, `isTypescriptApi`, `TYPESCRIPT6_PACKAGE` | каким компилятором оценивать спеки проекта |
| `mergeReports`, `mergeCoverage(reports, {platform?})`, `checkCoverageThreshold`, `summarizeCoverage`, `toJunitXml` | слияние отчётов и покрытия |
| `findSkippedTests`, `findRunFailures`, `checkReportFile(path, allowPartial)`, `parseListTestsOutput` | проверки отчёта |
| `waitForMachine(gate, log, signal?)`, `readMachineLoad(platform?)` | норма машины |
| `spawnProcess`, `signalProcessGroup` | настоящий порт процессов |
| `readBoundedInt`, `readPositiveInt` | разбор переменных с пределами |
| `ENV_NAMES`, `ENV_LIMITS`, `GROUP_DEFAULTS`, `EXIT_CODE`, `PROCESS_OUTCOME`, `TOOL_NAME`, `CACHE_DIR_SEGMENTS` | глубоко замороженные словари |

Импортируются только входы карты `exports` (`.` и `./package.json`).

## Гарантии и пределы

- Цена групп — **старт jest на каждую группу** (~0.5 с для JS плюс прогрев трансформа для
  TypeScript): набор на N тестов платит его ⌈N / 285⌉ раз. Уменьшает её только кэш трансформа jest
  (`cacheDirectory` вне временного каталога). Само планирование дёшево: 50 000 файлов — 2.6 с.
- Файл, тесты которого строит код, невидимый оценке, может один раз на холодном кэше превысить
  потолок; дальше план знает его факт. С `JEST_GROUPS_STRICT=1` (умолчание) такой прогон — код 2.
- Процесс, ушедший из сессии группы, и группа раннера, убитого SIGKILL, недоступны.
- Windows: потолок памяти не действует; экранирование строки запуска проверено на выходных строках,
  а не на настоящем Windows.
- Для pytest не поддержаны `--changed-since` и слияние покрытия; для vitest — слияние покрытия.
- **Строки журнала и тексты отказов — на русском.**

## Поведение при отказе

Fail-closed: переменная вне пределов, неизвестный флаг, нечитаемый или обрезанный отчёт группы,
файл, который не выполнен или выполнен дважды, пустая выборка, перегруженная машина — код 2 с
причиной, а не зелёный прогон. Отчёт и покрытие прошлого прогона удаляются до работы — прогон,
оборванный раньше записи, не оставляет зелёного отчёта прошлого для `jest-assert-no-skipped`.
Брошенное значение без прототипа или с бросающим `toString` всё равно даёт читаемый отказ.

## Совместимость

- Node.js ≥ 24.
- jest 30 (проверено на 30.5.2), vitest 4.1 и 5.1, pytest 9.2 + pytest-xdist 3.8.
- Оценка TypeScript: 5.9, 6.0, 7.0 с `@typescript/typescript6` (7.0 без него — регулярка).
- Группы процессов Linux и macOS; Windows — через `taskkill` (см. пределы).

## Разработка и тесты

```sh
pnpm install
python3 -m venv .venv && .venv/bin/pip install -r requirements-pytest.txt   # для спеки pytest-groups
pnpm run typecheck   # tsc, examples/*.ts против настоящего API, цитаты README равны examples
pnpm run lint        # biome
pnpm test            # сборка + весь набор самим собранным jest-groups
```

Спеки CLI запускают собранный `dist/bin/*.js` против поддельного jest (в том числе за shell-обёрткой
без `exec`), против настоящих jest 30, vitest 4.1 и 5.1 во временных проектах и против TypeScript
5.9, 6.0 и 7.0. Без venv Python спека pytest красная с этой инструкцией (не пропуск). Docker и базы
данных не нужны.

## Лицензия

[MIT](LICENSE) © 2026 Hoshino Tatsuya
