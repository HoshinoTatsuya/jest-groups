#!/usr/bin/env node
/**
 * Набор jest — последовательными группами не больше N тестов в каждой.
 *
 *   jest-groups --out <отчёт.json> [--dry-run] [--merge-coverage <coverage-final.json>]
 *               [--junit <отчёт.xml>] [--changed-since <ref>] [--shard <i>/<n>]
 *               [--from-group <N> | --failed-only] -- <команда jest>
 *   jest-groups --plan-only <план.json>
 *
 * <команда jest> задаёт выборку: `node_modules/.bin/jest`, `jest --config
 * jest.db.config.js`, `pnpm run --silent test:contract`. Раннер дописывает к ней
 * `--listTests --json` и пути группы с `--runTestsByPath` — шаблон выборки
 * остаётся в одном месте. Переменные и коды выхода — в README.
 */
import { runCli } from '../cli/run-cli';

runCli('jest', process.argv.slice(2));
