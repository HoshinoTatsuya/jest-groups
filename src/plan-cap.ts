import { GROUP_DEFAULTS } from './constants/group-defaults.constant';

/** Потолок ПЛАНА группы: предел факта минус запас на рост файлов с прошлого прогона. */
export const planCap = (max: number, headroomShare: number = GROUP_DEFAULTS.HEADROOM_SHARE): number =>
  Math.max(1, max - Math.ceil(max * headroomShare));
