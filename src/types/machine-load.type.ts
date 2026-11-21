/** Показания машины перед группой. */
export interface MachineLoad {
  /** Память, доступная новым процессам без вытеснения, байт. */
  readonly freeBytes: number;
  readonly totalBytes: number;
  /** load average за минуту; на Windows — null (не измеряется). */
  readonly load1: number | null;
  readonly cores: number;
}
