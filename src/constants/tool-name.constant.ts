import { deepFreeze } from '../deep-freeze';

/** Инструменты, которые раннер умеет гнать группами. */
export const TOOL_NAME = { jest: 'jest', vitest: 'vitest', pytest: 'pytest' } as const;

deepFreeze(TOOL_NAME);
