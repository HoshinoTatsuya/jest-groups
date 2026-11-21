#!/usr/bin/env node
/**
 * Набор vitest — последовательными группами, тем же планом, что у jest-groups.
 *
 *   vitest-groups --out <отчёт.json> [...] -- <команда vitest без подкоманды>
 *
 * Раннер дописывает `list --filesOnly --json` для выборки и `run <файлы>` для
 * группы: подкоманду (`run`, `watch`) в команду не писать.
 */
import { runCli } from '../cli/run-cli';

runCli('vitest', process.argv.slice(2));
