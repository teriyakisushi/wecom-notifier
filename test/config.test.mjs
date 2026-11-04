import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULTS } from '../src/inputs.mjs';
import { findEventTemplate, loadConfig, parseInlineObject } from '../src/config.mjs';

async function withWorkspace(fn) {
  const workspace = await mkdtemp(join(tmpdir(), 'wecom-config-'));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function inputs(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

test('finds a named per-event template in the template directory', async () => {
  await withWorkspace(async (workspace) => {
    const dir = join(workspace, '.github', 'wecom-notify');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'wecom-push.yml'),
      'msgtype: text\ntext:\n  content: "hello {{ repo.name }}"\n',
      'utf8',
    );

    const result = loadConfig({
      workspace,
      inputs: inputs(),
      eventName: 'push',
    });

    assert.equal(result.sourceKind, 'event-template');
    assert.equal(result.sourcePath, '.github/wecom-notify/wecom-push.yml');
    assert.equal(result.document.kind, 'message');
    assert.equal(result.document.message.msgtype, 'text');
  });
});

test('falls back to default.yml when no event-specific file exists', async () => {
  await withWorkspace(async (workspace) => {
    const dir = join(workspace, '.github', 'wecom-notify');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'default.yml'),
      'msgtype: markdown\nmarkdown:\n  content: fallback\n',
      'utf8',
    );

    const result = loadConfig({ workspace, inputs: inputs(), eventName: 'release' });

    assert.equal(result.sourceKind, 'event-template');
    assert.equal(result.document.message.msgtype, 'markdown');
  });
});

test('rejects more than one event template match', async () => {
  await withWorkspace(async (workspace) => {
    const dir = join(workspace, '.github', 'wecom-notify');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'push.yml'), 'msgtype: text\ntext:\n  content: one\n', 'utf8');
    await writeFile(join(dir, 'deploy-push.yml'), 'msgtype: text\ntext:\n  content: two\n', 'utf8');

    assert.throws(
      () => findEventTemplate({ workspace, templateDir: '.github/wecom-notify', eventName: 'push' }),
      /Multiple templates/,
    );
  });
});

test('normalizes an overrides-only template to extends: auto', () => {
  const result = loadConfig({
    workspace: process.cwd(),
    inputs: inputs({ payload: 'overrides:\n  text:\n    content: hi\n' }),
    eventName: 'push',
  });
  assert.equal(result.document.kind, 'config');
  assert.equal(result.document.extends, 'auto');
  assert.equal(result.document.overrides.text.content, 'hi');
});

test('rejects payload and template together', () => {
  assert.throws(
    () =>
      loadConfig({
        workspace: process.cwd(),
        inputs: inputs({ payload: 'msgtype: text', template: 'x.yml' }),
        eventName: 'push',
      }),
    /either "payload" or "template"/,
  );
});

test('rejects template paths outside the workspace', () => {
  assert.throws(
    () => loadConfig({ workspace: process.cwd(), inputs: inputs({ template: '../outside.yml' }), eventName: 'push' }),
    /escapes the workspace/,
  );
});

test('parses inline YAML mappings', () => {
  assert.deepEqual(parseInlineObject('a: 1\nb: two\n'), { a: 1, b: 'two' });
  assert.throws(() => parseInlineObject('just a string'), /must be an object/);
});
