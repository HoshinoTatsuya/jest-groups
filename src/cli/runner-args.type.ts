/** Флаги раннера (до `--`) после разбора. */
export interface RunnerArgs {
  readonly out: string;
  readonly dryRun: boolean;
  readonly mergeCoverageTo?: string;
  readonly junitTo?: string;
  readonly changedSince?: string;
  readonly shard?: { readonly index: number; readonly count: number };
  readonly fromGroup?: number;
  readonly failedOnly: boolean;
  readonly collectTests: boolean;
  readonly command: readonly string[];
}
