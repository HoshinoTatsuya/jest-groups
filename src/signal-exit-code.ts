import type { ExitCode } from './constants/exit-code.constant';
import { EXIT_CODE } from './constants/exit-code.constant';

/** Код выхода прерывания: 128 + номер сигнала, как у оболочки. */
export const signalExitCode = (reason: unknown): ExitCode =>
  reason === 'SIGINT' ? EXIT_CODE.sigint : reason === 'SIGHUP' ? EXIT_CODE.sighup : EXIT_CODE.sigterm;
