import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RunnerSandbox } from '../testing/runner-sandbox';

/**
 * Собранный `jest-groups`: TypeScript проекта (с JS API) бросает из разбора
 * значение без прототипа. Отказ раннера обязан быть строкой «ОТКАЗ раннера
 * групп» с кодом 2, а не необработанным TypeError из обработчика отказа.
 */
const ROOT = join(__dirname, '..', '..');
const RUNNER = join(ROOT, 'dist', 'bin', 'jest-groups.js');

describe('jest-groups: отказ, у которого String() бросает', () => {
  let sandbox: RunnerSandbox | undefined;
  afterEach(() => sandbox?.dispose());

  it('createSourceFile проекта бросает Object.create(null) — «ОТКАЗ раннера групп», код 2', () => {
    sandbox = new RunnerSandbox(RUNNER);
    const dir = sandbox.abs('node_modules/typescript');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'typescript', version: '5.9.3' }));
    writeFileSync(
      join(dir, 'index.js'),
      `const real = require(${JSON.stringify(realpathSync(join(ROOT, 'node_modules', 'typescript')))});\n` +
        'module.exports = { ...real, createSourceFile() { throw Object.create(null); } };\n',
    );
    sandbox.setCounts({ 'a.spec.ts': 1 });
    writeFileSync(sandbox.abs('a.spec.ts'), "it('a', () => undefined);\n");

    const result = sandbox.invoke({ flags: ['--dry-run'] });

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 2,
      stderr: 'ОТКАЗ раннера групп jest: [object Object]\n',
    });
  }, 30_000);
});
