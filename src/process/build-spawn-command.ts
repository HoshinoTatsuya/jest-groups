import { needsShell } from './needs-shell';
import { quoteCmdArgument } from './quote-cmd-argument';

/**
 * Что именно запускать. Вне Windows и для `.exe` — как есть. Для `.cmd`/`.bat`
 * — `cmd.exe /d /s /c "<строка>"` с `windowsVerbatimArguments`: строка
 * собирается раннером (`quoteCmdArgument`), а не Node — `shell: true` склеивал
 * аргументы в кавычках, и `%VAR%`/`!VAR!` в пути или шаблоне раскрывались.
 */
export const buildSpawnCommand = (
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.comspec ?? 'cmd.exe',
): { readonly command: string; readonly args: readonly string[]; readonly verbatim: boolean } => {
  if (!needsShell(executable, platform)) {
    return { command: executable, args, verbatim: false };
  }
  // Сама программа — без кавычек вокруг, только с ^ перед метасимволами.
  const program = executable.replace(/([()\][%!^"`<>&|;, *?])/g, '^$1');
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(executable);
  const line = [program, ...args.map((arg) => quoteCmdArgument(arg, doubleEscape))].join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
};
