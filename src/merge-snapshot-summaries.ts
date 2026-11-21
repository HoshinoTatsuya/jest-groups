/**
 * Итог снимков слитого отчёта. Прежде брался итог ПЕРВОЙ группы: устаревшие
 * снимки и непроверенные ключи остальных групп из отчёта пропадали. Поля
 * сливаются по смыслу (jest 30, `TestScheduler`): счётчики по файлам спек —
 * суммой; устаревшие ФАЙЛЫ снимков (`filesRemovedList`) jest ищет по всему
 * дереву в каждой группе — поэтому объединение, а не сумма (иначе их стало бы
 * «групп × N»); `failure` — если провалилась хоть одна группа.
 */
export const mergeSnapshotSummaries = (
  summaries: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined => {
  if (summaries.length === 0) {
    return undefined;
  }
  const merged: Record<string, unknown> = {};
  const keys = [...new Set(summaries.flatMap((summary) => Object.keys(summary)))];
  for (const key of keys) {
    const values = summaries.map((summary) => summary[key]).filter((value) => value !== undefined);
    if (key === 'filesRemovedList') {
      merged[key] = [...new Set(values.flatMap((value) => (Array.isArray(value) ? value : [])))].sort();
    } else if (values.every((value) => typeof value === 'number')) {
      merged[key] = (values as number[]).reduce((total, value) => total + value, 0);
    } else if (values.every((value) => typeof value === 'boolean')) {
      merged[key] = values.some(Boolean);
    } else if (values.every((value) => Array.isArray(value))) {
      merged[key] = values.flat();
    } else {
      merged[key] = values[0];
    }
  }
  if (Array.isArray(merged['filesRemovedList'])) {
    merged['filesRemoved'] = merged['filesRemovedList'].length;
  }
  return merged;
};
