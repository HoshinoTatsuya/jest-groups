import { deepFreeze } from '../deep-freeze';

/**
 * Каталог кэша раннера относительно корня проекта. В нём — по файлу на
 * инструмент и команду выборки (`<инструмент>-<хэш команды>.json`) и
 * состояние последнего прогона рядом. `counts.json` — кэш до 0.5.0: общий на
 * все команды, читается только как подсказка для команды без своей истории.
 */
export const CACHE_DIR_SEGMENTS = ['node_modules', '.cache', 'jest-test-groups'] as const;

deepFreeze(CACHE_DIR_SEGMENTS);
