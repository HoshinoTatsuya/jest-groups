import { JestGroupsError } from '../jest-groups.error';
import type { RunnerArgs } from './runner-args.type';

/**
 * Разбор `<флаги раннера> -- <команда>`. Неизвестный флаг раннера — отказ:
 * прежде опечатка (`--merge-coverge`) молча пропускалась, и прогон шёл без
 * того, о чём просили.
 */
export const parseRunnerArgs = (argv: readonly string[], usage: string): RunnerArgs => {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) {
    throw new JestGroupsError(usage);
  }
  const flags = argv.slice(0, separator);
  const valued = new Map<string, string>();
  const switches = new Set<string>();
  const VALUED = ['--out', '--merge-coverage', '--junit', '--changed-since', '--shard', '--from-group'];
  const SWITCHES = ['--dry-run', '--failed-only'];
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index] ?? '';
    const [name = '', inline] = flag.startsWith('--') && flag.includes('=') ? flag.split(/=(.*)/s) : [flag];
    if (VALUED.includes(name)) {
      const value = inline ?? flags[++index];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) {
        throw new JestGroupsError(`${name} без значения; ${usage}`);
      }
      valued.set(name, value);
    } else if (SWITCHES.includes(name) && inline === undefined) {
      switches.add(name);
    } else {
      throw new JestGroupsError(`неизвестный флаг раннера «${flag}»; ${usage}`);
    }
  }
  const out = valued.get('--out');
  if (out === undefined) {
    throw new JestGroupsError(`не задан --out <отчёт.json>; ${usage}`);
  }
  const shardText = valued.get('--shard');
  const shardMatch = shardText === undefined ? null : /^(\d+)\/(\d+)$/.exec(shardText);
  if (shardText !== undefined && shardMatch === null) {
    throw new JestGroupsError(`--shard «${shardText}»: нужна форма <номер>/<всего>, например 2/4`);
  }
  const fromText = valued.get('--from-group');
  if (fromText !== undefined && !/^\d+$/.test(fromText)) {
    throw new JestGroupsError(`--from-group «${fromText}»: нужен номер группы`);
  }
  if (fromText !== undefined && switches.has('--failed-only')) {
    throw new JestGroupsError('--from-group и --failed-only — разные способы возобновления, нужен один');
  }
  const mergeCoverageTo = valued.get('--merge-coverage');
  const junitTo = valued.get('--junit');
  const changedSince = valued.get('--changed-since');
  return {
    out,
    dryRun: switches.has('--dry-run'),
    failedOnly: switches.has('--failed-only'),
    command: argv.slice(separator + 1),
    ...(mergeCoverageTo === undefined ? {} : { mergeCoverageTo }),
    ...(junitTo === undefined ? {} : { junitTo }),
    ...(changedSince === undefined ? {} : { changedSince }),
    ...(shardMatch === null ? {} : { shard: { index: Number(shardMatch[1]), count: Number(shardMatch[2]) } }),
    ...(fromText === undefined ? {} : { fromGroup: Number(fromText) }),
  };
};
