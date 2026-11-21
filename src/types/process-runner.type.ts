import type { ProcessOutcome } from './process-outcome.type';
import type { RunProcessOptions } from './run-process-options.type';

export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  /** Чем кончился запуск; у портов без этого знания — `exited`. */
  readonly outcome?: ProcessOutcome;
  /** Пик суммарной памяти процессов группы, байт; null — не измерялась. */
  readonly peakRssBytes?: number | null;
  /** После выхода jest в его группе оставались процессы — они сняты. */
  readonly leftovers?: boolean;
}

/**
 * Запуск дочернего процесса. `capture` — stdout возвращается строкой (выборка
 * `--listTests`), `inherit` — вывод идёт в терминал (прогон группы). Порт нужен
 * тестам: раскладку и отказы раннера проверяют без настоящего jest.
 *
 * С 0.5.0 — с ограничениями (`RunProcessOptions`): отмена снимает ВСЮ группу
 * процессов (jest за обёрткой без exec прежде доигрывал сиротой), потолки
 * времени и памяти.
 */
export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  mode: 'capture' | 'inherit',
  options?: RunProcessOptions,
) => Promise<ProcessResult>;
