import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadProjectTypescript } from './cli/load-project-typescript';
import { runGroups } from './run-groups';
import { FakeToolRunner } from './testing/fake-tool-runner';
import type { ProcessRunner } from './types/process-runner.type';
import type { RunGroupsOptions } from './types/run-groups-options.type';

/**
 * Отказ, у которого `String()` сам бросает (значение без прототипа, бросающий
 * `toString`): ветка, которая его разбирает, обязана дать понятный отказ, а не
 * подменить его TypeError «Cannot convert object to primitive value».
 */
describe('текст «странного» отказа не бросает', () => {
  const strange = [
    ['без прототипа', (): unknown => Object.create(null)],
    [
      'с бросающим toString',
      (): unknown => ({
        toString: (): string => {
          throw new Error('toString');
        },
      }),
    ],
  ] as const;

  let root = '';
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jest-groups-strange-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const options = (run: ProcessRunner, signal: AbortSignal): RunGroupsOptions => {
    writeFileSync(join(root, 'a.spec.ts'), '');
    return {
      command: ['jest'],
      out: join(root, 'out', 'report.json'),
      cwd: root,
      maxTests: 300,
      workers: 2,
      keepGoing: false,
      dryRun: false,
      run,
      log: () => undefined,
      typescript: null,
      signal,
    };
  };

  it.each(strange)('runGroups: сигнал с причиной %s до выборки — отказ прерывания', async (_label, make) => {
    const fake = new FakeToolRunner();
    fake.counts = { [join(root, 'a.spec.ts')]: 1 };
    const controller = new AbortController();
    controller.abort(make());
    await expect(runGroups(options(fake.run, controller.signal))).rejects.toMatchObject({
      name: 'JestGroupsError',
      message: 'прерван сигналом [object Object] во время выборки',
      exitCode: 143,
    });
  });

  it.each(strange)(
    'runGroups: сигнал с причиной %s посреди группы — отказ прерывания',
    async (_label, make) => {
      const fake = new FakeToolRunner();
      fake.counts = { [join(root, 'a.spec.ts')]: 1 };
      const controller = new AbortController();
      const run: ProcessRunner = async (executable, args, mode, runOptions) => {
        const result = await fake.run(executable, args, mode, runOptions);
        if (args.includes('--runTestsByPath')) {
          controller.abort(make());
        }
        return result;
      };
      await expect(runGroups(options(run, controller.signal))).rejects.toMatchObject({
        name: 'JestGroupsError',
        message: 'прерван сигналом [object Object]: завершено групп 0 из 1, кэш сохранён',
        exitCode: 143,
      });
    },
  );

  it.each([
    ['без прототипа', 'throw Object.create(null);', '[object Object]'],
    ['с бросающим toString', "throw { toString() { throw new Error('toString'); } };", '[object Object]'],
    [
      'с бросающим геттером message',
      "throw { get message() { throw new Error('getter'); } };",
      '[object Object]',
    ],
  ])(
    'loadProjectTypescript: typescript проекта бросает значение %s — строка с причиной',
    (_label, body, text) => {
      const dir = join(root, 'node_modules', 'typescript');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'typescript', version: '5.9.3' }));
      writeFileSync(join(dir, 'index.js'), `${body}\n`);
      const result = loadProjectTypescript(root);
      expect(result.typescript).toBeNull();
      expect(result.note?.startsWith(`TypeScript проекта не загрузился (${text}), `)).toBe(true);
    },
  );
});
