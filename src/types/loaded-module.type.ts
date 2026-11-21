/**
 * Результат загрузки модуля проекта: нет самого модуля; модуль есть, но не
 * загрузился (битая установка, нет его зависимости); загружен.
 */
export type LoadedModule =
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly module: unknown };
