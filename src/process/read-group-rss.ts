import { readdirSync, readFileSync } from 'node:fs';

import type { RunTool } from '../types/run-tool.type';
import { readFootprints } from './read-footprints';
import { runTool } from './run-tool';

/**
 * Суммарная память процессов группы `pgid`, байт; null — измерить нечем. Linux — RSS из `/proc`
 * (в slim-образах нет `ps`); macOS — по каждому процессу большее из `phys_footprint` и RSS (RSS
 * там занижен сжатием страниц, а footprint меньше RSS бывает на общих страницах — потолок не
 * становится мягче прежнего); нет `footprint` или он не ответил — RSS. FreeBSD и OpenBSD — RSS из
 * `ps`. Windows — null: групп процессов POSIX там нет, и потолок памяти не действует (раннер
 * говорит об этом одной строкой на старте, а не молчит).
 */
export const readGroupRss = (
  pgid: number,
  platform: NodeJS.Platform = process.platform,
  run: RunTool = runTool,
): number | null => {
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
    const result = run('ps', ['-A', '-o', 'pgid=,pid=,rss=']);
    if (result.status !== 0) {
      return null;
    }
    const rss = new Map<number, number>();
    for (const line of result.stdout.split('\n')) {
      const [group, pid, kb] = line.trim().split(/\s+/);
      if (Number(group) === pgid) {
        rss.set(Number(pid), Number(kb) * 1024);
      }
    }
    const footprints =
      platform === 'darwin' ? readFootprints([...rss.keys()], run) : new Map<number, number>();
    let total = 0;
    for (const [pid, bytes] of rss) {
      total += Math.max(bytes, footprints.get(pid) ?? 0);
    }
    return total;
  }
  return null;
};
