#!/usr/bin/env node
// The TypeScript snippets of README.md and README.ru.md are quotes of examples/*.ts, which the
// typecheck compiles against the real API. A fenced block right after `<!-- example: <path> -->`
// must equal that file; an unmarked ```ts block is an error (it would be compiled by nobody).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
let quoted = 0;
for (const readme of ['README.md', 'README.ru.md']) {
  const lines = readFileSync(join(root, readme), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const fence = /^```(ts|typescript|js|javascript|mjs|cjs)\s*$/.exec(lines[i]);
    if (!fence) continue;
    const marker = /^<!-- example: (\S+) -->$/.exec(lines[i - 1] ?? '');
    const end = lines.indexOf('```', i + 1);
    if (end < 0) {
      problems.push(`${readme}:${i + 1}: unterminated code block`);
      break;
    }
    if (!marker) {
      problems.push(`${readme}:${i + 1}: ${fence[1]} block without "<!-- example: examples/<file> -->"`);
    } else {
      const path = join(root, marker[1]);
      const body = lines.slice(i + 1, end).join('\n').trim();
      if (!existsSync(path)) problems.push(`${readme}:${i}: ${marker[1]} does not exist`);
      else if (readFileSync(path, 'utf8').trim() !== body) problems.push(`${readme}:${i}: block differs from ${marker[1]}`);
      else quoted += 1;
    }
    i = end;
  }
}
if (quoted === 0) problems.push('no quoted examples found: the check would prove nothing');
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`README examples: ${quoted} blocks equal their examples/*.ts files`);
