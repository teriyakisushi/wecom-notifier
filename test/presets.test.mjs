import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildContext } from '../src/context.mjs';
import { runNotify } from '../src/index.mjs';
import { normalizeMessage } from '../src/message/normalize.mjs';
import { validateMessage } from '../src/message/validate.mjs';
import { getPreset, PRESET_NAMES } from '../src/presets/index.mjs';
import { renderMessage } from '../src/template/render.mjs';
import { pruneEmpty } from '../src/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/events');
const SNAPSHOTS = path.join(ROOT, 'tests/snapshots');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const NOW = new Date('2026-11-04T00:00:00.000Z');
const REPO = 'teriyakisushi/wecom-notifier';

const EVENTS = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

/** Presets that read event-specific data get their own fixture. */
const PRESET_EVENT = {
  pull_request: 'pull_request',
  issues: 'issues',
  issue_comment: 'issue_comment',
  release: 'release',
  workflow_run: 'workflow_run',
  star: 'star',
  fork: 'fork',
  create: 'create',
  delete: 'delete',
};

function loadEvent(event) {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${event}.json`), 'utf8'));
}

function contextFor(event) {
  return buildContext({
    eventName: event,
    event: loadEvent(event),
    env: {
      GITHUB_REPOSITORY: REPO,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_API_URL: 'https://api.github.com',
    },
    inputs: { vars: {} },
    now: NOW,
  });
}

function silentLogger() {
  const warnings = [];
  return {
    debugEnabled: false,
    warnings,
    addSecret() {},
    debug() {},
    info() {},
    warn(code, message, warningPath) {
      warnings.push({ code, message, path: warningPath });
    },
    error() {},
    summary() {},
  };
}

/**
 * Golden files live in tests/snapshots and are only written when
 * UPDATE_SNAPSHOTS=1, so a deleted or edited snapshot fails loudly.
 */
function assertSnapshot(name, value) {
  const file = path.join(SNAPSHOTS, `${name}.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (UPDATE) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `missing snapshot ${name}.json — run UPDATE_SNAPSHOTS=1 npm test`);
  assert.equal(readFileSync(file, 'utf8'), text, `snapshot drift in ${name}.json — re-run UPDATE_SNAPSHOTS=1 after reviewing the diff`);
}

test('fixtures exist for every documented event', () => {
  for (const event of ['push', 'pull_request', 'issues', 'issue_comment', 'release', 'workflow_run', 'star', 'fork', 'create', 'delete']) {
    assert.ok(EVENTS.includes(event), `missing fixture for ${event}`);
  }
});

test('every preset renders a valid message for its fixture', () => {
  const rendered = [];
  for (const preset of PRESET_NAMES) {
    if (preset === 'auto' || preset === 'none') continue;
    const event = PRESET_EVENT[preset] ?? 'push';
    const ctx = contextFor(event);
    const message = getPreset(preset, {
      ctx,
      eventName: event,
      inputs: { content: 'preset matrix: hello', linkUrl: `${ctx.repo?.html_url}/actions` },
    });
    const value = pruneEmpty(renderMessage(message, ctx).value);
    const normalized = normalizeMessage(value);
    const report = validateMessage(normalized.message, { warnings: normalized.warnings });
    assert.deepEqual(
      report.errors,
      [],
      `${preset} (${event}) produced invalid output: ${JSON.stringify(report.errors)}`,
    );
    assert.ok(Object.keys(normalized.message).length > 0, `${preset} produced an empty message`);
    assertSnapshot(`presets/${preset}`, normalized.message);
    rendered.push(preset);
  }
  assert.ok(rendered.length >= 14, `expected the preset matrix to cover the registry, covered ${rendered.length}`);
});

test('the auto preset produces a stable payload for every fixture', async () => {
  for (const event of EVENTS) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), `wecom-${event}-`));
    const result = await runNotify({
      env: {
        GITHUB_EVENT_NAME: event,
        GITHUB_EVENT_PATH: path.join(FIXTURES, `${event}.json`),
        GITHUB_WORKSPACE: ROOT,
        GITHUB_OUTPUT: path.join(tmp, 'output.txt'),
        GITHUB_REPOSITORY: REPO,
        GITHUB_SERVER_URL: 'https://github.com',
        INPUT_PRESET: 'auto',
        INPUT_DRY_RUN: 'true',
        INPUT_FAIL_ON_ERROR: 'true',
      },
      cwd: ROOT,
      now: NOW,
      logger: silentLogger(),
    });
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result.errors ?? result.error)}`);
    assert.equal(result.status, 'dry-run');
    assert.ok(result.message.msgtype, `${event}: no msgtype`);
    assertSnapshot(`auto/${event}`, result.message);
  }
});

test('a real webhook run is never attempted in dry-run mode', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wecom-nofetch-'));
  let calls = 0;
  const result = await runNotify({
    env: {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: path.join(FIXTURES, 'push.json'),
      GITHUB_WORKSPACE: ROOT,
      GITHUB_OUTPUT: path.join(tmp, 'output.txt'),
      GITHUB_REPOSITORY: REPO,
      INPUT_WEBHOOK: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key',
      INPUT_DRY_RUN: 'true',
    },
    cwd: ROOT,
    now: NOW,
    logger: silentLogger(),
    fetchImpl: async () => {
      calls += 1;
      throw new Error('should not be called');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
});
