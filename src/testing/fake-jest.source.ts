/** Поддельный jest: файлы и число тестов — из FAKE_COUNTS (путь → n). */
export const FAKE_JEST = `
const fs = require('node:fs');
const args = process.argv.slice(2);
const counts = JSON.parse(fs.readFileSync(process.env.FAKE_COUNTS, 'utf8'));
const mult = args.includes('--config=db') ? 20 : 1;
if (args.includes('--showConfig')) {
  const projects = Number(process.env.FAKE_PROJECTS || 1);
  const threshold = process.env.FAKE_THRESHOLD ? JSON.parse(process.env.FAKE_THRESHOLD) : undefined;
  console.log('строка шума перед конфигом');
  console.log(JSON.stringify({ configs: Array.from({ length: projects }, () => ({})), globalConfig: { coverageThreshold: threshold } }, null, 2));
  process.exit(0);
}
if (args.includes('--listTests')) {
  if (process.env.FAKE_LIST_HANG) {
    const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n');
    process.on('SIGTERM', () => { log({ event: 'term' }); if (!process.env.FAKE_IGNORE_TERM) process.exit(143); });
    setTimeout(() => { log({ event: 'self-exit' }); process.exit(9); }, 20000);
    if (process.env.FAKE_LIST_ESCAPE) {
      // Процесс, сбежавший из группы (своя сессия), держит stdout выборки.
      const escaped = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });
      log({ event: 'escaped', pid: escaped.pid });
    }
    log({ event: 'hanging', pid: process.pid });
    return;
  }
  console.log('строка шума перед списком');
  const only = process.env.FAKE_ONLY ? process.env.FAKE_ONLY.split(',') : null;
  console.log(JSON.stringify(Object.keys(counts).filter((f) => !only || only.includes(f))));
  process.exit(0);
}
const out = args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
const files = args.slice(args.indexOf('--runTestsByPath') + 1);
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n');
log({ event: 'start', pid: process.pid, files, workers: args.find((a) => a.startsWith('--maxWorkers=')), argv: args.join(' ').length });
if (process.env.FAKE_HANG && files.includes(process.env.FAKE_HANG)) {
  process.on('SIGTERM', () => { log({ event: 'term' }); if (!process.env.FAKE_IGNORE_TERM) process.exit(143); });
  // Сироту, если тест упадёт до сигнала, убирает таймер, а не человек.
  setTimeout(() => { log({ event: 'self-exit' }); process.exit(9); }, 20000);
  log({ event: 'hanging', pid: process.pid });
  return;
}
if (process.env.FAKE_ALLOC_MB) {
  // Тяжёлая спека: память занята и тронута (иначе RSS не растёт), процесс ждёт.
  const held = Buffer.alloc(Number(process.env.FAKE_ALLOC_MB) * 1024 * 1024, 1);
  log({ event: 'allocated', pid: process.pid, bytes: held.length });
  setTimeout(() => { log({ event: 'self-exit' }); process.exit(9); }, 20000);
  return;
}
if (process.env.FAKE_LEAK) {
  // Тест оставил процесс: потомок без detached — в группе процессов jest.
  const leaked = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  log({ event: 'leak', pid: leaked.pid });
}
// Отчёт, обрезанный посреди записи (jest убит, полный диск), и отчёт, не записанный вовсе.
if (process.env.FAKE_REPORT === 'truncated') {
  fs.writeFileSync(out, '{"numTotalTests": 3, "testRes');
  process.exit(0);
}
if (process.env.FAKE_REPORT === 'none') {
  process.exit(0);
}
const coverageDir = args.find((a) => a.startsWith('--coverageDirectory='));
if (coverageDir) {
  const dir = coverageDir.slice('--coverageDirectory='.length);
  fs.mkdirSync(dir, { recursive: true });
  const coverage = { '/src/shared.ts': { path: '/src/shared.ts', s: { '0': 1 } } };
  for (const file of files) coverage[file + '.src'] = { path: file + '.src', s: { '0': 1 } };
  fs.writeFileSync(dir + '/coverage-final.json', JSON.stringify(coverage));
}
const results = files
  .filter((file) => file !== process.env.FAKE_DROP)
  .map((file) => ({
    name: file,
    assertionResults: Array.from({ length: counts[file] * mult }, (_, k) => ({
      fullName: 't' + k,
      status: file === process.env.FAKE_FAIL && k === 0 ? 'failed' : 'passed',
    })),
  }));
if (process.env.FAKE_TWICE) {
  const twin = results.find((r) => r.name === process.env.FAKE_TWICE);
  if (twin) results.push(twin);
}
const tests = results.flatMap((r) => r.assertionResults);
const failed = tests.filter((t) => t.status === 'failed').length;
fs.writeFileSync(out, JSON.stringify({
  numTotalTests: tests.length,
  numPassedTests: tests.length - failed,
  numFailedTests: failed,
  numPendingTests: 0,
  numTotalTestSuites: results.length,
  startTime: 1,
  success: failed === 0,
  testResults: results,
}));
log({ event: 'end' });
process.exit(failed === 0 ? 0 : 1);
`;
