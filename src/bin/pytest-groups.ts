#!/usr/bin/env node
/**
 * Набор pytest — последовательными группами, тем же планом, что у jest-groups.
 * Нужен pytest-xdist: воркеры группы — `-n <JEST_GROUP_WORKERS>`.
 *
 *   pytest-groups --out <отчёт.json> [--junit <отчёт.xml>] [...] -- <команда pytest без путей>
 *
 * Выборку задавать `-k`/`-m`/`testpaths`, а не путями: путь в команде попал бы
 * в каждую группу.
 */
import { runCli } from '../cli/run-cli';

runCli('pytest', process.argv.slice(2));
