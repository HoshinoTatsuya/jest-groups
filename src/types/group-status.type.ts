import type { GROUP_STATUS } from '../constants/group-status.constant';

export type GroupStatus = (typeof GROUP_STATUS)[keyof typeof GROUP_STATUS];
