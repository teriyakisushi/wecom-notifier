/**
 * examples/custom 模板预览的共用零件：枚举模板、推断事件、读 .env、改 fixture、
 * 调 runNotify 渲染/发送。被 preview-custom.mjs（非交互）和 preview-interactive.mjs 共用。
 *
 * 约定：webhook 只在内存里传，永远不进 argv，也不打印。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runNotify } from '../../src/index.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE_DIR = path.join(ROOT, 'examples', 'custom');
export const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'events');
export const DEFAULT_PREVIEW_DIR = path.join(ROOT, '.research', 'tmp');

export const EVENT_ALIASES = {
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

export function listTemplates() {
  return readdirSync(TEMPLATE_DIR)
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(TEMPLATE_DIR, name));
}

/** `# lint:event foo` 优先，否则用文件名里最后一个已知事件片段。 */
export function eventFor(file) {
  const source = readFileSync(file, 'utf8');
  const hint = /^\s*#\s*lint:event\s+(\S+)/mu.exec(source);
  if (hint) return hint[1];
  const tokens = path.basename(file, path.extname(file)).toLowerCase().split(/[^a-z0-9_]+/u).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const event = EVENT_ALIASES[tokens[index]];
    if (event) return event;
  }
  return 'push';
}

/** 名字可以是片段；匹配不到抛错（带上可选项，方便交互式重问）。 */
export function pick(files, names) {
  if (!names.length) return files;
  const chosen = [];
  for (const name of names) {
    const needle = name.replace(/\.ya?ml$/iu, '').toLowerCase();
    const hits = files.filter((file) => path.basename(file, path.extname(file)).toLowerCase().includes(needle));
    if (!hits.length) {
      throw new Error(`没找到匹配 "${name}" 的模板（可用：${files.map((f) => path.basename(f)).join(', ')}）`);
    }
    for (const hit of hits) if (!chosen.includes(hit)) chosen.push(hit);
  }
  return chosen;
}

export function readDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function resolveWebhook() {
  const fromEnv = process.env.INPUT_WEBHOOK || process.env.WECOM_WEBHOOK;
  if (fromEnv) return { value: fromEnv.trim(), origin: '环境变量' };
  const dotenv = readDotEnv(path.join(ROOT, '.env'));
  const fromFile = dotenv.INPUT_WEBHOOK || dotenv.WECOM_WEBHOOK;
  if (fromFile) return { value: fromFile.trim(), origin: '.env' };
  return { value: '', origin: '未配置' };
}

/** 按 --conclusion/--status 改一份临时事件文件，返回路径（不需要改就返回原 fixture）。 */
export function prepareEvent(eventName, options, tempDir) {
  const fixture = options.fixture ? path.resolve(ROOT, options.fixture) : path.join(FIXTURE_DIR, `${eventName}.json`);
  if (!existsSync(fixture)) throw new Error(`没有 ${eventName} 的事件 fixture：${path.relative(ROOT, fixture)}`);
  if (!options.conclusion && !options.status) return fixture;
  const event = JSON.parse(readFileSync(fixture, 'utf8'));
  if (!event.workflow_run) throw new Error('--conclusion/--status 只对 workflow_run 事件有用');
  if (options.conclusion) {
    event.workflow_run.conclusion = options.conclusion;
    event.workflow_run.status = options.status ?? 'completed';
  }
  if (options.status) event.workflow_run.status = options.status;
  const target = path.join(tempDir, `${eventName}-patched.json`);
  writeFileSync(target, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return target;
}

/** 渲染（或发送）一个模板；临时目录用完即删。 */
export async function renderOne(file, options, { webhook = '', outputFile }) {
  const eventName = options.event ?? eventFor(file);
  const tempDir = mkdtempSync(path.join(tmpdir(), 'wecom-preview-'));
  const stem = path.basename(file, path.extname(file));
  let fixture;
  try {
    fixture = prepareEvent(eventName, options, tempDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  mkdirSync(options.htmlDir, { recursive: true });
  const html = path.join(options.htmlDir, `${stem}.html`);
  const env = { GITHUB_OUTPUT: outputFile };
  if (webhook) env.INPUT_WEBHOOK = webhook;
  try {
    const result = await runNotify({
      env,
      cli: {
        template: path.relative(ROOT, file),
        event: path.relative(ROOT, fixture),
        eventName,
        dryRun: !options.send,
        html: path.relative(process.cwd(), html),
      },
      cwd: ROOT,
    });
    return { file, stem, eventName, result, html };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function describe({ stem, eventName, result, html }) {
  const size = `${(Buffer.byteLength(result.payload ?? '', 'utf8') / 1024).toFixed(1)} KB`;
  const key = result.errcode === undefined ? '' : `  errcode=${result.errcode}`;
  const warn = result.warnings?.length ? `  ⚠${result.warnings.length}` : '';
  const status = String(result.status).padEnd(7);
  return `✓ ${stem.padEnd(24)} [${eventName}] ${String(result.msgtype).padEnd(13)} ${status} ${size}${key}${warn}  ${path.relative(ROOT, html)}`;
}
