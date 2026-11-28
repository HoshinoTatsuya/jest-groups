/**
 * Процесс-сторож раннера (его запускает `ProcessWatchdog`, своя сессия): `runWatchdog` на stdin.
 * SIGINT/SIGTERM/SIGHUP сторож игнорирует: решать, когда снимать группы, — дело раннера, а
 * сторож обязан пережить того, кто снял раннер вместе с его группой процессов.
 */
import { runWatchdog } from './run-watchdog';

for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(name, () => undefined);
}
void runWatchdog(process.stdin).then(() => process.exit(0));
