'use strict';
/**
 * Замер цены группировки. Запуск: `pnpm build && node bench/capacity.cjs`.
 *
 *  1. планирование без запуска: оценка числа тестов по AST и раскладка
 *     (`estimateTests`, `planGroups`) на 1 / 10 / 50 тыс. файлов;
 *  2. сквозной прогон в mkdtemp-проекте: 3 000 тривиальных тестов в 300
 *     файлах — сколько стоит запуск jest на каждую группу. Тесты идут группами
 *     по ≤300 и `--maxWorkers=2`, как требует сама библиотека.
 */
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, sep } = require('node:path');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const { estimateTests, planGroups } = require('../dist/index.js');

const spec = (index, tests) =>
  `describe('модуль ${index}', () => {\n${Array.from(
    { length: tests },
    (_, t) => `  it('случай ${t}', () => {\n    expect(${t} + 1).toBe(${t + 1});\n  });\n`,
  ).join('')}});\n`;

function planning() {
  console.log('## 1. планирование (без запуска)');
  for (const files of [1_000, 10_000, 50_000]) {
    const texts = Array.from({ length: files }, (_, i) => spec(i, 1 + (i % 25)));
    let started = performance.now();
    const entries = texts.map((text, i) => ({ file: `src/m${i}.spec.ts`, tests: estimateTests(ts, `m${i}.spec.ts`, text) }));
    const estimateMs = performance.now() - started;
    started = performance.now();
    const groups = planGroups(entries, 285);
    const planMs = performance.now() - started;
    const total = entries.reduce((sum, entry) => sum + entry.tests, 0);
    console.log(
      `файлов ${files} (тестов ${total}): оценка по AST ${(estimateMs / 1000).toFixed(2)} с, раскладка ${planMs.toFixed(0)} мс, групп ${groups.length}`,
    );
  }
}

function endToEnd() {
  console.log('## 2. сквозной прогон: 300 файлов × 10 тестов');
  const root = mkdtempSync(join(tmpdir(), 'jest-groups-bench-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'bench', private: true }));
    writeFileSync(join(root, 'jest.config.js'), "module.exports = { testEnvironment: 'node', maxWorkers: 2 };\n");
    mkdirSync(join(root, 'src'));
    for (let i = 0; i < 300; i++) {
      writeFileSync(join(root, 'src', `m${i}.spec.js`), spec(i, 10));
    }
    const jest = join(__dirname, '..', 'node_modules', '.bin', 'jest');
    const cli = join(__dirname, '..', 'dist', 'bin', 'jest-groups.js');
    const run = (label, args) => {
      const started = performance.now();
      const output = execFileSync(process.execPath, [cli, '--out', join(root, `${label}.json`), '--', jest, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const seconds = (performance.now() - started) / 1000;
      const groups = (output.match(/групп[аы]? \d+\/\d+|group \d+\/\d+/gi) ?? []).length;
      return { seconds, groups, output };
    };
    // Первый прогон греет кэш числа тестов и кэш трансформа jest.
    run('warm', []);
    const all = run('all', []);
    const one = run('one', ['--testPathPatterns', 'src/m0\\.spec\\.js$']);
    console.log(
      `3 000 тестов: ${all.seconds.toFixed(1)} с; один файл (одна группа): ${one.seconds.toFixed(1)} с — фиксированная цена группы`,
    );
    console.log(all.output.split('\n').filter((line) => /групп|group/i.test(line)).slice(0, 3).join('\n'));
  } finally {
    // Удаляется только каталог, созданный mkdtemp этим прогоном.
    if (root.startsWith(tmpdir() + sep) && root.includes('jest-groups-bench-')) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

planning();
endToEnd();
