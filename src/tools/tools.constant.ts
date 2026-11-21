import type { ToolAdapter } from '../types/tool-adapter.type';
import type { ToolName } from '../types/tool-name.type';
import { JEST_TOOL } from './jest.tool';
import { PYTEST_TOOL } from './pytest.tool';
import { VITEST_TOOL } from './vitest.tool';

/** Адаптер по имени инструмента. */
export const TOOLS: Readonly<Record<ToolName, ToolAdapter>> = {
  jest: JEST_TOOL,
  vitest: VITEST_TOOL,
  pytest: PYTEST_TOOL,
};
