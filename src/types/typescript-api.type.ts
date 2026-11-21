/**
 * JS API TypeScript, которым раннер разбирает спеки: модуль `typescript`
 * линий 5.x и 6.x или пакет `@typescript/typescript6`. Своё описание, а не
 * тип пакета `typescript`: у TypeScript 7 (компилятор на Go) главный вход —
 * только `{ version, versionMajorMinor }`, типов прежнего API в нём нет, и
 * объявления библиотеки на них не ссылаются.
 *
 * Здесь — то, что видно компилятору потребителя; перед разбором раннер
 * проверяет ВСЕ члены, которыми пользуется (`TYPESCRIPT_API_MEMBERS`).
 */
export interface TypescriptApi {
  readonly version: string;
  readonly createSourceFile: (...args: never[]) => unknown;
  readonly forEachChild: (...args: never[]) => unknown;
  readonly ScriptTarget: { readonly Latest: number };
  readonly NodeFlags: { readonly Const: number };
}
