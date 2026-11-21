/**
 * Текст для атрибута или тела XML: пять сущностей и снятие управляющих
 * символов, которых в XML 1.0 нет вовсе (ANSI-цвета в сообщениях jest —
 * `\u001b[31m` — делали файл невалидным, и CI отбрасывал весь отчёт).
 */
export const escapeXml = (text: string): string =>
  text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: снимаются именно управляющие символы
    .replace(/\u001b\[[0-9;]*m/g, '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: недопустимые в XML 1.0 символы
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
