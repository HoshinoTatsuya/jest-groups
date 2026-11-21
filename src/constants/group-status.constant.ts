import { deepFreeze } from '../deep-freeze';

/** Исход группы в состоянии прогона: по нему возобновление выбирает, что гнать снова. */
export const GROUP_STATUS = {
  passed: 'passed',
  failed: 'failed',
  interrupted: 'interrupted',
  notRun: 'not-run',
} as const;

deepFreeze(GROUP_STATUS);
