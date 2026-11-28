import { signalProcessGroup } from './signal-process-group';

/**
 * Сигнал группе при УБОРКЕ (выход прямого потомка, потолок, выход раннера, сторож): EPERM — не
 * ошибка, а «доставить уже некому». macOS отвечает EPERM на `kill(-pgid)`, когда в группе остались
 * одни зомби: jest за shell-обёрткой убит, а прибрать его ещё не успели. Брошенное исключение в
 * обработчике выхода роняло раннер кодом 1 вместо 143 («прерван сигналом»), а сторожа — посреди
 * уборки остальных групп. Прочие ошибки пробрасываются; защита pid (0, ±1) — прежняя.
 */
export const signalGroupQuietly = (pgid: number, signal: NodeJS.Signals): void => {
  try {
    signalProcessGroup(pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
      throw error;
    }
  }
};
