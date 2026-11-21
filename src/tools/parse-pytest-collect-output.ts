/**
 * Выборка из вывода `pytest --collect-only -q`: запись на КАЖДЫЙ тест (путь
 * файла повторяется по числу тестов) — число тестов файла известно точно.
 * Понимает обе тихие формы: `-q` (`путь::тест` на строку) и `-qq` (`путь: N`,
 * если в команде уже есть `-q`). Строк той формы нет вовсе — null: это отказ,
 * а не пустая выборка; пустую выборку pytest отвечает кодом 5 и строкой «no
 * tests collected» — тогда пустой массив.
 */
export const parsePytestCollectOutput = (stdout: string): string[] | null => {
  const paths: string[] = [];
  let recognized = false;
  for (const line of stdout.split(/\r?\n/)) {
    const node = /^([^\s:][^:]*)::\S/.exec(line);
    if (node?.[1] !== undefined) {
      paths.push(node[1]);
      recognized = true;
      continue;
    }
    const counted = /^([^\s:][^:]*): (\d+)$/.exec(line);
    if (counted?.[1] !== undefined && counted[2] !== undefined) {
      paths.push(...Array.from({ length: Number(counted[2]) }, () => counted[1] ?? ''));
      recognized = true;
      continue;
    }
    if (/^no tests (?:collected|ran)\b/.test(line)) {
      recognized = true;
    }
  }
  return recognized ? paths : null;
};
