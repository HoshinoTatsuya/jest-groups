import type { JSON_FILE_READ } from '../constants/json-file-read.constant';

export type JsonFileRead<T> =
  | { readonly kind: typeof JSON_FILE_READ.missing }
  | { readonly kind: typeof JSON_FILE_READ.invalid; readonly reason: string }
  | { readonly kind: typeof JSON_FILE_READ.ok; readonly value: T };
