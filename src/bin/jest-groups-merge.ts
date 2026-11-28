#!/usr/bin/env node
/**
 * Склейка отчётов шардов CI (`jest-groups --shard i/n` на разных машинах) в отчёт всего набора.
 *
 *   jest-groups-merge --out <отчёт.json> [--junit <отчёт.xml>]
 *                     [--merge-coverage <coverage-final.json> --coverage <покрытие шарда>…]
 *                     <отчёт шарда>… [-- <команда jest>]
 *
 * Склеенный отчёт не частичный, только если шарды одной раскладки складываются в весь набор
 * ровно по разу; дальше его проверяет `jest-assert-no-skipped`. Код выхода — через
 * process.exitCode (запись в pipe асинхронна).
 */
import { runMergeCli } from '../cli/run-merge-cli';

void runMergeCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
