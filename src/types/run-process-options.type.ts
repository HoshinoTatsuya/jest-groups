/**
 * Чем ограничен запуск процесса группы. Всё необязательное: выборка
 * `--listTests` идёт без потолка памяти, группа — со всеми.
 */
export interface RunProcessOptions {
  /** Отмена (сигнал раннеру): снять всю группу процессов. */
  readonly signal?: AbortSignal;
  /** Потолок времени, мс: дольше — снять группу, исход `timeout`. */
  readonly timeoutMs?: number;
  /** Ожидание выхода после SIGTERM до SIGKILL всей группы, мс. */
  readonly killGraceMs?: number;
  /** Потолок суммарной памяти процессов группы, байт: больше — снять, исход `memory`. */
  readonly maxRssBytes?: number;
  /** Через сколько мс сообщить о подозрении на зависание (один раз). */
  readonly stallAfterMs?: number;
  readonly onStall?: (elapsedMs: number) => void;
  /** Окружение процесса поверх унаследованного. */
  readonly env?: Readonly<Record<string, string>>;
}
