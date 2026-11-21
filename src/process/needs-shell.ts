/**
 * `.cmd`/`.bat` (обёртки node_modules/.bin на Windows) Node с 20-й версии без
 * оболочки не запускает (EINVAL) — им нужен cmd.exe.
 */
export const needsShell = (executable: string, platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
