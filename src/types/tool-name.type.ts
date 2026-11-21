import type { TOOL_NAME } from '../constants/tool-name.constant';

export type ToolName = (typeof TOOL_NAME)[keyof typeof TOOL_NAME];
