import type { TestEntry } from './types/test-entry.type';

/**
 * Группы не больше `max` тестов — упаковкой first-fit decreasing: файлы от
 * тяжёлых к лёгким, каждый — в первую группу, где хватает места. Групп выходит
 * меньше, чем при раскладке по порядку имён (там лёгкий файл после тяжёлого
 * открывал новую группу), а каждая группа — это свой запуск jest с его
 * globalSetup. Файл тяжелее `max` идёт группой из одного файла — делить файл
 * раннер не умеет, и к такой группе ничего не добавляется.
 *
 * `maxDurationMs` — второй потолок, по ожидаемому времени файлов (кэш
 * длительности): группа из 285 быстрых тестов и группа из 50 тяжёлых по числу
 * одинаковы, по нагрузке — нет. Файл без известного времени в этот потолок не
 * засчитывается.
 *
 * Раскладка детерминирована: при равном числе тестов — по имени; внутри группы
 * файлы по имени, группы — в порядке открытия.
 */
export const planGroups = (
  entries: readonly TestEntry[],
  max: number,
  maxDurationMs?: number,
): string[][] => {
  const ordered = [...entries].sort(
    (left, right) =>
      right.tests - left.tests || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  );
  const groups: { files: string[]; sum: number; duration: number }[] = [];
  for (const { file, tests, durationMs = 0 } of ordered) {
    const target = groups.find(
      (group) =>
        group.sum + tests <= max &&
        (maxDurationMs === undefined || group.duration + durationMs <= maxDurationMs),
    );
    if (target === undefined) {
      groups.push({ files: [file], sum: tests, duration: durationMs });
    } else {
      target.files.push(file);
      target.sum += tests;
      target.duration += durationMs;
    }
  }
  return groups.map((group) => group.files.sort());
};
