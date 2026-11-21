/** Отпечаток файла для свежести кэша. */
export interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}
