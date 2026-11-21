/** Часть отчёта `jest --json`, которую читает раннер. Остальные поля переносятся как есть. */
export interface JestAssertion {
  readonly status: string;
  readonly fullName: string;
}

export interface JestSuiteResult {
  readonly name: string;
  readonly assertionResults?: readonly JestAssertion[];
}

export interface JestReport {
  readonly numTotalTests?: number;
  readonly numPassedTests?: number;
  readonly numFailedTests?: number;
  readonly numPendingTests?: number;
  readonly numTodoTests?: number;
  readonly numTotalTestSuites?: number;
  readonly numPassedTestSuites?: number;
  readonly numFailedTestSuites?: number;
  readonly numPendingTestSuites?: number;
  readonly numRuntimeErrorTestSuites?: number;
  readonly startTime?: number;
  readonly success?: boolean;
  readonly testResults?: readonly JestSuiteResult[];
  readonly [extra: string]: unknown;
}
