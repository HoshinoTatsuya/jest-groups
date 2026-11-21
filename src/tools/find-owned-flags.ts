/**
 * Флаги команды, которые раннер задаёт каждой группе сам, — в ЛЮБОМ написании,
 * которое понимает разборщик argv инструмента (yargs у jest, cac у vitest):
 * `--maxWorkers`, `--max-workers`, `--max-workers=16` — одно имя; группа
 * коротких флагов `-bi` — это `-b -i`; `-w4` — `-w` со значением. Прежде
 * сверялось только camelCase, и `--max-workers=16` проходил мимо отказа, а
 * `--watch-all` вешал хук. `--no-<флаг>` (выключение) раннеру не мешает.
 *
 * `long` — имена в camelCase в нижнем регистре, `short` — буквы, `words` —
 * позиционные слова-подкоманды (у vitest: `run`, `watch`, `list`…), `valuedShort` —
 * короткие флаги со значением: в группе `-kn` после `k` идёт значение, а не флаг `-n`.
 */
export const findOwnedFlags = (
  args: readonly string[],
  owned: {
    readonly long: readonly string[];
    readonly short: readonly string[];
    readonly words: readonly string[];
    readonly longPrefixes?: readonly string[];
    readonly valuedShort?: readonly string[];
  },
): string[] =>
  args.filter((arg) => {
    const long = /^--([^=]+)/.exec(arg)?.[1];
    if (long !== undefined) {
      if (long.startsWith('no-')) {
        return false;
      }
      const name = long
        .replace(/-+([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase())
        .toLowerCase();
      return (
        owned.long.includes(name) || (owned.longPrefixes ?? []).some((prefix) => name.startsWith(prefix))
      );
    }
    const letters = /^-([a-zA-Z]+)/.exec(arg)?.[1];
    if (letters !== undefined) {
      // Буква флага со значением (`-k выражение` у pytest) кончает группу: дальше — значение.
      for (const letter of letters) {
        if (owned.short.includes(letter)) {
          return true;
        }
        if ((owned.valuedShort ?? []).includes(letter)) {
          return false;
        }
      }
      return false;
    }
    return owned.words.includes(arg);
  });
