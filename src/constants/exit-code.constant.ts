import { deepFreeze } from '../deep-freeze';

/**
 * Коды выхода раннера. Различаются, потому что лечатся по-разному: упавшие
 * тесты — это код, отказ раннера (пустая выборка, jest не записал отчёт,
 * файл выполнен дважды, неверная настройка) — это конфигурация, прерывание —
 * ни то ни другое (CI отменил джобу, под получил SIGTERM, закрыт терминал — SIGHUP).
 */
export const EXIT_CODE = {
  testsFailed: 1,
  runner: 2,
  /** 128 + номер сигнала — как у оболочки. */
  sighup: 129,
  sigint: 130,
  sigterm: 143,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

deepFreeze(EXIT_CODE);
