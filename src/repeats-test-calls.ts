/**
 * Повторяет ли текст спеки вызов теста столько раз, сколько регулярка не сосчитает: таблица
 * `.each` или ЦИКЛ, внутри которого есть вызов теста (`for`, `for await`, `while`, `do`,
 * `forEach`/`map`/`flatMap`). Тело цикла — сбалансированные скобки после заголовка, а у цикла без
 * фигурных скобок — его оператор до `;` или конца строки.
 *
 * Прежде регулярка циклы не видела: `for (const n of cases()) it(...)` был «доказанным» одним
 * тестом, и файл на 7 тестов шёл в общую группу за 1. Но и «любой цикл в файле» — слишком
 * широко: `expect(rows.map(f))` внутри теста — не повтор теста, а с ним «не доказанным» стал бы
 * почти каждый файл JS-проекта, каждый на холодном кэше — своей группой.
 */
export const repeatsTestCalls = (text: string): boolean => {
  const TEST_CALL = /\b(?:[xf]?it|x?test)(?:\.\w+)*\s*\(/;
  const LOOP = /\.each\b|\bdo\s*\{|\bfor\s*(?:await\s*)?\(|\bwhile\s*\(|\.(?:forEach|map|flatMap)\s*\(/g;
  const OPEN: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
  /** Конец сбалансированной скобки, открытой в `start` (строки пропускаются); нет — конец текста. */
  const closing = (start: number): number => {
    const stack: string[] = [];
    for (let index = start; index < text.length; index++) {
      const char = text[index] ?? '';
      if (char === "'" || char === '"' || char === '`') {
        for (index++; index < text.length && text[index] !== char; index++) {
          if (text[index] === '\\') {
            index++;
          }
        }
      } else if (OPEN[char] !== undefined) {
        stack.push(OPEN[char] ?? '');
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          return index;
        }
      }
    }
    return text.length;
  };
  for (const match of text.matchAll(LOOP)) {
    if (match[0] === '.each') {
      return true;
    }
    const opened = (match.index ?? 0) + match[0].length - 1;
    let body: string;
    if (match[0].startsWith('.') || text[opened] === '{') {
      // forEach/map/flatMap(...) — тело в аргументах вызова; do { ... } — в фигурных скобках.
      body = text.slice(opened, closing(opened) + 1);
    } else {
      // for (...) / while (...): заголовок, затем блок или один оператор.
      let next = closing(opened) + 1;
      while (next < text.length && /\s/.test(text[next] ?? '')) {
        next++;
      }
      if (text[next] === '{') {
        body = text.slice(next, closing(next) + 1);
      } else {
        let end = next;
        while (end < text.length && text[end] !== ';' && text[end] !== '\n') {
          end = OPEN[text[end] ?? ''] === undefined ? end + 1 : closing(end) + 1;
        }
        body = text.slice(next, end);
      }
    }
    if (TEST_CALL.test(body)) {
      return true;
    }
  }
  return false;
};
