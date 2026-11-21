import { join } from 'node:path';

import { writeAtomically } from '../files/write-atomically';
import type { RunState } from '../types/run-state.type';

/** Запись состояния прогона — после каждой группы, атомарно: переживает сигнал и падение. */
export const writeRunState = (dir: string, key: string, state: RunState): void => {
  writeAtomically(join(dir, `${key}.last-run.json`), `${JSON.stringify(state, null, 1)}\n`);
};
