import type { PROCESS_OUTCOME } from '../constants/process-outcome.constant';

export type ProcessOutcome = (typeof PROCESS_OUTCOME)[keyof typeof PROCESS_OUTCOME];
