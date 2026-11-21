/**
 * Текст отказа процентного порога покрытия — как у jest ТОЙ версии, что стоит
 * в проекте (`CoverageReporter._checkThreshold`): до 30.4 —
 * `"<имя>" coverage threshold for <метрика> (<порог>%) not met: <факт>%`, с
 * 30.4 — `Coverage for <метрика> (<факт>%) does not meet "<имя>" threshold
 * (<порог>%)`. Версия неизвестна (обёртка не отдала её в `--showConfig`) —
 * текст новейшего jest.
 */
export const percentThresholdFailure = (
  name: string,
  key: string,
  threshold: number,
  actual: number,
  jestVersion: string | null,
): string => {
  const [major, minor] = (jestVersion ?? '').split('.').map((part) => Number.parseInt(part, 10));
  const before304 =
    major !== undefined && minor !== undefined && !Number.isNaN(major) && !Number.isNaN(minor)
      ? major < 30 || (major === 30 && minor < 4)
      : false;
  return before304
    ? `Jest: "${name}" coverage threshold for ${key} (${threshold}%) not met: ${actual}%`
    : `Jest: Coverage for ${key} (${actual}%) does not meet "${name}" threshold (${threshold}%)`;
};
