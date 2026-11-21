import { findClosingBracket } from './find-closing-bracket';

/**
 * ПОСЛЕДНЕЕ значение JSON с открывающей скобкой (`[` или `{`) в начале строки,
 * которое принимает `accept`. Перед ним бывают строки обёртки (`pnpm run`
 * печатает заголовок), после — строки журнала, поэтому ищется с конца. Скобка
 * не в начале строки началом не считается: `[` внутри пути в однострочном
 * выводе дала бы ложный массив.
 */
export const findLastJson = <T>(
  stdout: string,
  opening: '[' | '{',
  accept: (value: unknown) => value is T,
): T | null => {
  const pattern = opening === '[' ? /^[ \t]*\[/gm : /^[ \t]*\{/gm;
  const starts = [...stdout.matchAll(pattern)].map((match) => match.index + match[0].length - 1);
  for (const start of starts.reverse()) {
    const end = findClosingBracket(stdout, start);
    if (end < 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
      if (accept(parsed)) {
        return parsed;
      }
    } catch {
      // не JSON (строка журнала вида `[info] …`) — ищем дальше
    }
  }
  return null;
};
