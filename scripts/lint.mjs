#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const roots = ['src', 'scripts', 'test', 'tests'];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.mjs')) files.push(full);
  }
}

for (const root of roots) walk(root);

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  console.log(`ok ${relative(process.cwd(), file)}`);
}

console.log(`checked ${files.length} files`);
