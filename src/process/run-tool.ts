import { spawnSync } from 'node:child_process';

import { GROUP_DEFAULTS } from '../constants/group-defaults.constant';
import type { RunTool } from '../types/run-tool.type';

/** Внешняя утилита замера памяти: `spawnSync` с потолком ожидания (зависшая не держит опрос). */
export const runTool: RunTool = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: GROUP_DEFAULTS.FOOTPRINT_TIMEOUT_MS });
  return { status: result.status, stdout: result.stdout ?? '' };
};
