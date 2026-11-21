/**
 * Позиция `]` или `}`, закрывающей массив или объект с открывающей скобкой в
 * позиции `start`, с учётом строк JSON (скобка внутри пути —
 * `app/[id]/page.spec.ts` — не считается). `-1` — не закрыт.
 */
export const findClosingBracket = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') {
        index++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};
