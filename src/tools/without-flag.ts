/**
 * Аргументы без флага `name` (camelCase, как его пишет jest) в любом
 * написании: `--name=v`, `--name v`, `--kebab-name=v`, `--kebab-name v`.
 * Нужен раннеру там, где флаг он ПЕРЕОПРЕДЕЛЯЕТ для групп (`--coverageThreshold`:
 * порог сверяет раннер по слитому покрытию), а дубль флага yargs отдал бы
 * jest массивом.
 */
export const withoutFlag = (args: readonly string[], name: string): string[] => {
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg === `--${name}` || arg === `--${kebab}`) {
      index++;
      continue;
    }
    if (arg.startsWith(`--${name}=`) || arg.startsWith(`--${kebab}=`)) {
      continue;
    }
    result.push(arg);
  }
  return result;
};
