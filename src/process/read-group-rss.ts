import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Суммарная память (RSS) процессов группы `pgid`, байт; null — измерить
 * нечем. Linux — `/proc` (в slim-образах нет `ps`), macOS — `ps`, Windows —
 * null: групп процессов POSIX там нет, и потолок памяти не действует (раннер
 * говорит об этом одной строкой на старте, а не молчит).
 */
export const readGroupRss = (pgid: number, platform: NodeJS.Platform = process.platform): number | null => {
  if (platform === 'linux') {
    let total = 0;
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
        // Имя процесса в скобках может содержать пробелы: поля — после последней `)`.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (Number(fields[2]) !== pgid) {
          continue;
        }
        const status = readFileSync(`/proc/${entry}/status`, 'utf8');
        const kb = /^VmRSS:\s+(\d+)\s+kB/m.exec(status)?.[1];
        total += kb === undefined ? 0 : Number(kb) * 1024;
      } catch {
        // процесс завершился между readdir и чтением
      }
    }
    return total;
  }
  if (platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd') {
    const result = spawnSync('ps', ['-A', '-o', 'pgid=,rss='], { encoding: 'utf8' });
    if (result.status !== 0) {
      return null;
    }
    let total = 0;
    for (const line of result.stdout.split('\n')) {
      const [group, rss] = line.trim().split(/\s+/);
      if (Number(group) === pgid) {
        total += Number(rss) * 1024;
      }
    }
    return total;
  }
  return null;
};
