#!/usr/bin/env node
/**
 * Coverage gate.
 *
 * Runs the test suite with Node's built-in coverage and enforces the thresholds
 * declared under `coverageThreshold` in package.json. Failing the gate fails CI,
 * which keeps the suite from quietly rotting as features land.
 *
 * Usage: node scripts/check-coverage.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const DEFAULTS = { lines: 85, branches: 75, functions: 85 };

function thresholds() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return { ...DEFAULTS, ...(pkg.coverageThreshold ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

function runTests() {
  const args = ['--test', '--experimental-test-coverage'];
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env } });
}

/**
 * Node prints the coverage table on stdout (or stderr on older versions) as
 * `# all files |  line |  branch |  funcs | ...`.
 */
function parseCoverage(text) {
  const row = /^#?\s*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/mu.exec(text);
  if (!row) return null;
  return { lines: Number(row[1]), branches: Number(row[2]), functions: Number(row[3]) };
}

const limits = thresholds();
const result = runTests();
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (result.status !== 0) {
  const tail = output.trim().split('\n').slice(-40).join('\n');
  console.error('Tests failed; coverage was not evaluated.\n');
  console.error(tail);
  process.exit(1);
}

const actual = parseCoverage(output);
if (!actual) {
  console.error('Could not find an "all files" coverage row in the test output.');
  console.error(output.trim().split('\n').slice(-20).join('\n'));
  process.exit(1);
}

const rows = [
  ['lines', actual.lines, limits.lines],
  ['branches', actual.branches, limits.branches],
  ['functions', actual.functions, limits.functions],
];

let failed = false;
console.log('Coverage gate');
for (const [name, value, required] of rows) {
  const ok = value >= required;
  if (!ok) failed = true;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${value.toFixed(2).padStart(6)}% (minimum ${required}%)`);
}

if (failed) {
  console.error('\nCoverage is below the configured threshold. Add tests or adjust coverageThreshold in package.json.');
  process.exit(1);
}

console.log('  gate passed');
