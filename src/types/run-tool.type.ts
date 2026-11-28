/** Запуск внешней утилиты: подменяется в спеке, в работе — `spawnSync`. */
export type RunTool = (command: string, args: string[]) => { status: number | null; stdout: string };
