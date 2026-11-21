import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GROUP_STATUS } from '../constants/group-status.constant';
import type { RunState } from '../types/run-state.type';

/** Состояние последнего прогона команды; нет или не той формы — null. */
export const readRunState = (dir: string, key: string): RunState | null => {
  try {
    const raw = JSON.parse(readFileSync(join(dir, `${key}.last-run.json`), 'utf8')) as Partial<RunState>;
    const statuses: readonly string[] = Object.values(GROUP_STATUS);
    if (
      raw.version === 1 &&
      Array.isArray(raw.groups) &&
      raw.groups.every((group) => Array.isArray(group) && group.every((file) => typeof file === 'string')) &&
      Array.isArray(raw.statuses) &&
      raw.statuses.length === raw.groups.length &&
      raw.statuses.every((status) => statuses.includes(status)) &&
      Array.isArray(raw.command)
    ) {
      return raw as RunState;
    }
  } catch {
    // состояния нет
  }
  return null;
};
