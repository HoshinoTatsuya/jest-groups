import { JestGroupsError } from './jest-groups.error';
import { mergeReports } from './merge-reports';
import type { JestReport } from './types/jest-report.type';
import type { ReportMeta } from './types/report-meta.type';

/**
 * Склейка отчётов шардов (`--shard i/n` на разных машинах CI) в один отчёт всего набора.
 * Отчёт одного шарда помечен частичным, и `jest-assert-no-skipped` его не примет; склеенный —
 * уже весь набор, если склейка доказала полноту. Доказательство — по пометкам раннера, а не по
 * числу файлов:
 *
 * - все отчёты — шарды одной раскладки (тот же инструмент, то же число шардов, тот же отпечаток
 *   плана): шарды разных выборок или версий кода складывались бы в «набор», которого нет;
 * - номера шардов — ровно 1…n, каждый по разу: пропавшая машина CI иначе выглядела бы чистым
 *   прогоном;
 * - ни один файл не числится в двух шардах.
 *
 * Причины частичности, кроме самого шарда (`changed-since …`), обязаны совпадать у всех шардов и
 * переходят в склеенный отчёт: «только изменённое» на всех машинах — всё ещё не весь набор.
 * Что каждый шард выполнил ровно свои файлы, проверил раннер в своём прогоне.
 */
export const mergeShardReports = (
  inputs: readonly { readonly path: string; readonly report: JestReport }[],
): JestReport => {
  if (inputs.length === 0) {
    throw new JestGroupsError('склеивать нечего: не задано ни одного отчёта шарда');
  }
  const shards = inputs.map(({ path, report }) => {
    const meta = report.jestGroups as ReportMeta | undefined;
    const match = typeof meta?.shard === 'string' ? /^(\d+)\/(\d+)$/.exec(meta.shard) : null;
    if (meta === undefined || match === null) {
      throw new JestGroupsError(`${path}: не отчёт шарда раннера групп (нет пометки jestGroups.shard)`);
    }
    if (typeof meta.plan !== 'string' || !Array.isArray(meta.files)) {
      throw new JestGroupsError(
        `${path}: в отчёте шарда нет отпечатка плана и списка файлов — отчёт записан версией раннера ` +
          'до 0.9.0; перезапустите шард',
      );
    }
    const others = (meta.partial ?? '')
      .split(', ')
      .filter((reason) => reason !== '' && !reason.startsWith('shard '))
      .join(', ');
    return {
      path,
      report,
      meta,
      index: Number(match[1]),
      count: Number(match[2]),
      others,
    };
  });
  const [first] = shards;
  if (first === undefined) {
    throw new JestGroupsError('склеивать нечего: не задано ни одного отчёта шарда');
  }
  for (const shard of shards) {
    const differs = [
      shard.meta.tool !== first.meta.tool ? `инструмент ${shard.meta.tool} ≠ ${first.meta.tool}` : null,
      shard.count !== first.count ? `шардов ${shard.count} ≠ ${first.count}` : null,
      shard.meta.plan !== first.meta.plan ? `план ${shard.meta.plan} ≠ ${first.meta.plan}` : null,
      shard.others !== first.others ? `причины частичности «${shard.others}» ≠ «${first.others}»` : null,
    ].filter((line): line is string => line !== null);
    if (differs.length > 0) {
      throw new JestGroupsError(
        `${shard.path} и ${first.path} — шарды разных прогонов: ${differs.join('; ')}`,
      );
    }
  }
  const byIndex = new Map<number, string[]>();
  for (const shard of shards) {
    byIndex.set(shard.index, [...(byIndex.get(shard.index) ?? []), shard.path]);
  }
  const repeated = [...byIndex].filter(([, paths]) => paths.length > 1);
  if (repeated.length > 0) {
    throw new JestGroupsError(
      `шард задан дважды: ${repeated.map(([index, paths]) => `${index}/${first.count} — ${paths.join(', ')}`).join('; ')}`,
    );
  }
  const missing = Array.from({ length: first.count }, (_, index) => index + 1).filter(
    (index) => !byIndex.has(index),
  );
  if (missing.length > 0) {
    throw new JestGroupsError(
      `нет отчётов шардов ${missing.map((index) => `${index}/${first.count}`).join(', ')} — ` +
        'без них склейка выглядела бы проверкой всего набора',
    );
  }
  const owner = new Map<string, string>();
  const shared: string[] = [];
  for (const shard of shards) {
    for (const file of shard.meta.files ?? []) {
      const previous = owner.get(file);
      if (previous !== undefined) {
        shared.push(`${file} (${previous} и ${shard.path})`);
      }
      owner.set(file, shard.path);
    }
  }
  if (shared.length > 0) {
    throw new JestGroupsError(`файлы числятся в двух шардах: ${shared.join(', ')}`);
  }
  const ordered = [...shards].sort((left, right) => left.index - right.index);
  const meta: ReportMeta = {
    tool: first.meta.tool,
    groups: ordered.reduce((total, shard) => total + shard.meta.groups, 0),
    shards: first.count,
    ...(first.others === '' ? {} : { partial: first.others }),
  };
  return { ...mergeReports(ordered.map((shard) => shard.report)), jestGroups: meta };
};
