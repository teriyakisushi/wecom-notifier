#!/usr/bin/env node
/**
 * Lint every message template under `examples/`.
 *
 * A template is rendered against a real event fixture with `--dry-run`, so this
 * catches YAML syntax errors, unknown filters, broken `when`/`for`/`variants`
 * blocks, missing required fields, and field-length warnings that the unit
 * tests never see.
 *
 * GitHub workflow fragments (anything with `on:` / `jobs:`) are skipped: they
 * reference the action rather than a message template.
 *
 * Usage:
 *   node scripts/lint-templates.mjs [dirs...] [--strict] [--verbose]
 *
 * `--strict` also fails on warnings (field truncation and the like).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';

import { runNotify } from '../src/index.mjs';
import { Logger } from '../src/log.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'events');

const EVENT_ALIASES = {
  push: 'push',
  notify: 'push',
  default: 'push',
  pr: 'pull_request',
  pull_request: 'pull_request',
  issues: 'issues',
  issue: 'issues',
  comment: 'issue_comment',
  issue_comment: 'issue_comment',
  release: 'release',
  workflow_run: 'workflow_run',
  ci: 'workflow_run',
  star: 'star',
  fork: 'fork',
  create: 'create',
  delete: 'delete',
};

function parseArgs(argv) {
  const dirs = [];
  const flags = { strict: false, verbose: false };
  for (const arg of argv) {
    if (arg === '--strict') flags.strict = true;
    else if (arg === '--verbose') flags.verbose = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else dirs.push(arg);
  }
  return { dirs: dirs.length ? dirs : ['examples'], ...flags };
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.ya?ml$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * `# lint:event pull_request` wins; otherwise the last known event-ish token in
 * the file name is used, so `wecom-workflow_run.yml` maps to `workflow_run`.
 */
function eventFor(file, source) {
  const hint = /^\s*#\s*lint:event\s+(\S+)/mu.exec(source);
  if (hint) return hint[1];
  const tokens = path
    .basename(file, path.extname(file))
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const event = EVENT_ALIASES[tokens[index]];
    if (event) return event;
  }
  return 'push';
}

function isWorkflowFragment(document) {
  if (!document || typeof document !== 'object') return false;
  return Boolean(document.jobs) || Boolean(document.on) || Boolean(document.steps);
}

function describeIssue(issue) {
  const where = issue.path ? ` (${issue.path})` : '';
  return `${issue.code ?? 'warning'}: ${issue.message}${where}`;
}

async function lintFile(file, { strict, verbose }) {
  const source = readFileSync(file, 'utf8');
  let document;
  try {
    document = parse(source);
  } catch (error) {
    return { file, status: 'error', detail: `invalid YAML: ${error.message}` };
  }

  if (isWorkflowFragment(document)) {
    return { file, status: 'skipped', detail: 'GitHub workflow fragment' };
  }

  const eventName = eventFor(file, source);
  const fixture = path.join(FIXTURE_DIR, `${eventName}.json`);
  try {
    readFileSync(fixture, 'utf8');
  } catch {
    return { file, status: 'error', detail: `no fixture for event "${eventName}" (${path.relative(ROOT, fixture)})` };
  }

  const logs = [];
  const logger = new Logger({
    env: {},
    debug: verbose,
    stdout: { write: (text) => (logs.push(text), true) },
    stderr: { write: (text) => (logs.push(text), true) },
  });

  // Redirecting GITHUB_OUTPUT keeps runNotify from dumping the payload onto
  // stdout; the file itself is disposable.
  const tmp = mkdtempSync(path.join(tmpdir(), 'wecom-lint-'));
  const outputFile = path.join(tmp, 'github_output');
  writeFileSync(outputFile, '');
  try {
    const result = await runNotify({
      env: { GITHUB_OUTPUT: outputFile },
      cli: { template: path.relative(ROOT, file), event: path.relative(ROOT, fixture), eventName, dryRun: true },
      cwd: ROOT,
      logger,
    });
    const warnings = result.warnings ?? [];
    const problems = warnings.map(describeIssue);
    if (strict && problems.length) {
      return { file, status: 'error', detail: problems.join('; '), eventName, msgtype: result.msgtype };
    }
    return {
      file,
      status: 'ok',
      eventName,
      msgtype: result.msgtype,
      warnings: problems,
      detail: `${result.msgtype} · ${result.status}${problems.length ? ` · ${problems.length} warning(s)` : ''}`,
    };
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : '';
    const where = error?.path ? ` (${error.path})` : '';
    const hint = error?.hint ? `\n    hint: ${error.hint}` : '';
    return { file, status: 'error', detail: `${code}${error?.message ?? error}${where}${hint}`, eventName };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const files = options.dirs.flatMap((dir) => walk(path.resolve(ROOT, dir)));
  if (!files.length) {
    console.error('No template files found. Pass a directory, for example: examples/');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const file of files) results.push(await lintFile(file, options));
  let failures = 0;
  let warnings = 0;

  for (const result of results) {
    const name = path.relative(ROOT, result.file);
    if (result.status === 'skipped') {
      console.log(`skip ${name} — ${result.detail}`);
      continue;
    }
    if (result.status === 'error') {
      failures += 1;
      console.error(`fail ${name} [${result.eventName ?? '?'}] — ${result.detail}`);
      continue;
    }
    warnings += result.warnings.length;
    const suffix = result.warnings.length ? `\n${result.warnings.map((line) => `       ${line}`).join('\n')}` : '';
    console.log(`ok   ${name} [${result.eventName}] — ${result.detail}${suffix}`);
  }

  const checked = results.filter((result) => result.status !== 'skipped').length;
  const summary = `${checked} template(s) checked, ${warnings} warning(s), ${failures} failure(s)`;
  if (failures) {
    console.error(summary);
    process.exitCode = 1;
    return;
  }
  console.log(summary);
}

await main();
