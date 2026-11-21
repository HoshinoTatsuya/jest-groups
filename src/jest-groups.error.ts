import { EXIT_CODE, type ExitCode } from './constants/exit-code.constant';

/**
 * Отказ раннера. `exitCode` различает упавшие тесты (1), отказ самого раннера
 * (2, по умолчанию) и прерывание сигналом (130/143).
 */
export class JestGroupsError extends Error {
  public override readonly name = 'JestGroupsError';

  public constructor(
    message: string,
    public readonly exitCode: ExitCode = EXIT_CODE.runner,
  ) {
    super(message);
  }
}
