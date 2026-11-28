import type { RunTool } from '../types/run-tool.type';

/**
 * `phys_footprint` процессов `pids`, байт, из `footprint --noCategories -f bytes`. Это мера, которую
 * macOS сама считает нагрузкой процесса (столбец «Память» Мониторинга системы): резидентные
 * страницы плюс сжатые и выгруженные в своп. RSS на macOS её занижает: замер 28.11.2026 —
 * процесс с буфером 400 МБ, который больше не трогают, через полсекунды показывал 36 МБ RSS, а
 * затем 28 МБ, при footprint 412 МБ всё время, — под нехваткой памяти система сжимает нетронутые
 * страницы (на свободной машине RSS и footprint совпадают). Процесс,
 * которого уже нет, `footprint` пропускает (строка в stderr, код 0) — его в ответе просто нет.
 * Строка заголовка: `<имя> [<pid>]: 64-bit    Footprint: <n> B …`; имя может содержать что угодно,
 * поэтому берётся ПОСЛЕДНЯЯ `[pid]:` перед `Footprint:`, и только из запрошенных pid.
 */
export const readFootprints = (pids: number[], run: RunTool): Map<number, number> => {
  const found = new Map<number, number>();
  if (pids.length === 0) {
    return found;
  }
  const result = run('footprint', [
    '--noCategories',
    '-f',
    'bytes',
    ...pids.flatMap((pid) => ['-p', String(pid)]),
  ]);
  const asked = new Set(pids);
  for (const line of result.stdout.split('\n')) {
    const match = /^.*\[(\d+)\]: \S+\s+Footprint: (\d+) B/.exec(line);
    if (match !== null && asked.has(Number(match[1]))) {
      found.set(Number(match[1]), Number(match[2]));
    }
  }
  return found;
};
