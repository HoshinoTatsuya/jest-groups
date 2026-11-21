#!/usr/bin/env node
/**
 * Проверяет отчёт jest (--json) или слитый отчёт раннера групп: прогон
 * успешен, ни одного пропущенного теста, хотя бы один выполненный — иначе
 * код 1 (нечитаемый отчёт — 2). Правила — `checkReportFile`.
 *
 *   jest-assert-no-skipped [--allow-partial] <jest.json>
 *
 * Код выхода — через process.exitCode: `process.exit()` сразу после записи в
 * pipe обрезал список пропусков (запись в pipe асинхронна) — CI показывал
 * «ОТКАЗ» без перечня.
 */
import { checkReportFile } from '../check-report-file';

const args = process.argv.slice(2);
const allowPartial = args.includes('--allow-partial');
const paths = args.filter((arg) => arg !== '--allow-partial');
if (paths.length !== 1 || paths[0]?.startsWith('--')) {
  console.error('использование: jest-assert-no-skipped [--allow-partial] <jest.json>');
  process.exitCode = 2;
} else {
  const result = checkReportFile(paths[0] ?? '', allowPartial);
  for (const line of result.lines) {
    (result.exitCode === 0 ? console.log : console.error)(line);
  }
  process.exitCode = result.exitCode;
}
