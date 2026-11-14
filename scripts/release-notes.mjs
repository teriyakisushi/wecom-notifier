#!/usr/bin/env node
/**
 * 用 CHANGELOG.md 里对应版本的段落生成 Release 正文。
 *
 * 用法：
 *   node scripts/release-notes.mjs v0.2.0 [--changelog CHANGELOG.md]
 *
 * 找不到段落或段落为空时以非零码退出，让 release workflow 直接失败，
 * 而不是悄悄发一个只有 "Full Changelog" 的 Release。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractReleaseNotes } from './lib/release-notes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(argv) {
  const args = [...argv];
  let changelog = path.join(ROOT, 'CHANGELOG.md');
  let tag;

  while (args.length) {
    const arg = args.shift();
    if (arg === '--changelog') {
      changelog = path.resolve(args.shift() ?? '');
    } else if (arg === '-h' || arg === '--help') {
      console.log('Usage: node scripts/release-notes.mjs <tag> [--changelog <file>]');
      return 0;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (tag === undefined) {
      tag = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!tag) throw new Error('Missing tag, e.g. v0.2.0');

  const notes = extractReleaseNotes(readFileSync(changelog, 'utf8'), tag);
  process.stdout.write(`${notes}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`release-notes: ${error.message}`);
  process.exitCode = 1;
}
