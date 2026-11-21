import type { GroupStatus } from './group-status.type';

/**
 * Состояние последнего прогона команды: план и исход каждой группы. Пишется
 * после КАЖДОЙ группы (атомарно), поэтому переживает падение и сигнал —
 * возобновление (`--from-group`, `--failed-only`) берёт план отсюда.
 */
export interface RunState {
  readonly version: 1;
  readonly command: readonly string[];
  readonly groups: readonly (readonly string[])[];
  readonly statuses: readonly GroupStatus[];
}
