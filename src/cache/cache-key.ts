import { createHash } from 'node:crypto';

import type { ToolName } from '../types/tool-name.type';

/**
 * Ключ кэша команды выборки. Прежде кэш был один на проект, и `test` с
 * `test:db` (другой конфиг, другие setupFiles — другое число тестов того же
 * файла) планировали друг друга чужими фактами: группа выходила за потолок.
 * Флаги РАННЕРА (`--changed-since`, `--shard`, возобновление) в ключ не входят:
 * узкий прогон той же команды обновляет те же факты.
 */
export const cacheKey = (tool: ToolName, command: readonly string[]): string =>
  `${tool}-${createHash('sha256').update(JSON.stringify(command)).digest('hex').slice(0, 16)}`;
