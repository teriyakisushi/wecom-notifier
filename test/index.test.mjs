import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runNotify } from '../src/index.mjs';
import { ValidationError } from '../src/errors.mjs';

const pushFixture = join(process.cwd(), 'tests', 'fixtures', 'events', 'push.json');

function silentLogger() {
  return {
    debugEnabled: false,
    addSecret() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    summary() {},
  };
}

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'wecom-run-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runs the push event preset without sending', async () => {
  await withTemp(async (dir) => {
    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: { dryRun: true, eventName: 'push', eventPath: pushFixture },
      logger: silentLogger(),
      fetchImpl: () => {
        throw new Error('fetch must not be called during dry-run');
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'dry-run');
    assert.equal(result.msgtype, 'template_card');
    assert.equal(result.origin, 'preset:push');
    assert.match(result.payload, /teriyakisushi\/wecom-notifier/u);
  });
});

test('builds a flat card preset', async () => {
  await withTemp(async (dir) => {
    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: {
        dryRun: true,
        eventName: 'push',
        eventPath: pushFixture,
        preset: 'card',
        title: 'Deploy complete',
        subtitle: 'production',
        content: 'Version 1.2.3',
        info: '版本: 1.2.3\n分支: main',
        linkUrl: 'https://example.com/run',
      },
      logger: silentLogger(),
    });

    assert.equal(result.msgtype, 'template_card');
    assert.equal(result.message.template_card.main_title.title, 'Deploy complete');
    assert.equal(result.message.template_card.horizontal_content_list.length, 2);
    assert.equal(result.message.template_card.card_action.url, 'https://example.com/run');
  });
});

test('loads the one-file-per-event template and renders it', async () => {
  await withTemp(async (dir) => {
    const templateDir = join(dir, '.github', 'wecom-notify');
    await mkdir(templateDir, { recursive: true });
    await writeFile(
      join(templateDir, 'wecom-push.yml'),
      'msgtype: text\ntext:\n  content: "{{ repo.full_name }} pushed {{ commit_count }} commits"\n',
      'utf8',
    );

    const result = await runNotify({
      env: { GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: { dryRun: true, eventName: 'push', eventPath: pushFixture },
      logger: silentLogger(),
    });

    assert.equal(result.origin, 'inline message');
    assert.equal(result.message.text.content, 'teriyakisushi/wecom-notifier pushed 2 commits');
  });
});

test('applies inline overrides and vars', async () => {
  await withTemp(async (dir) => {
    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: {
        dryRun: true,
        eventName: 'push',
        payload: 'msgtype: markdown\nmarkdown:\n  content: "env={{ vars.env }}"\n',
        vars: 'env: production',
        overrides: '{"markdown":{"content":"overridden"}}',
      },
      logger: silentLogger(),
    });

    assert.equal(result.message.markdown.content, 'overridden');
  });
});

test('maps the watch event to the star preset', async () => {
  await withTemp(async (dir) => {
    const event = JSON.parse(await readFile(pushFixture, 'utf8'));
    event.action = 'created';
    event.repository.stargazers_count = 42;
    const eventPath = join(dir, 'watch.json');
    await writeFile(eventPath, JSON.stringify(event), 'utf8');

    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: { dryRun: true, eventName: 'watch', eventPath },
      logger: silentLogger(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.origin, 'preset:star');
    assert.equal(result.message.template_card.main_title.title, '⭐ 收到新 Star');
  });
});

test('rejects invalid messages before sending', async () => {
  await withTemp(async (dir) => {
    await assert.rejects(
      runNotify({
        env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
        cli: {
          dryRun: true,
          eventName: 'push',
          payload: 'msgtype: text\ntext: {}\n',
        },
        logger: silentLogger(),
      }),
      (error) => error instanceof ValidationError,
    );
  });
});

test('sends through the webhook when dry-run is disabled', async () => {
  await withTemp(async (dir) => {
    let called = false;
    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: {
        webhook: 'test-key',
        eventName: 'push',
        eventPath: pushFixture,
        preset: 'text',
        content: 'hello',
      },
      logger: silentLogger(),
      fetchImpl: async () => {
        called = true;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok' }),
        };
      },
      sleep: async () => {},
    });

    assert.equal(called, true);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'sent');
    assert.match(await readFile(join(dir, 'output.txt'), 'utf8'), /^msgtype=text$/mu);
  });
});

test('fail-on-error false turns a send failure into a non-throwing result', async () => {
  await withTemp(async (dir) => {
    const result = await runNotify({
      env: { GITHUB_OUTPUT: join(dir, 'output.txt') },
      cli: {
        webhook: 'test-key',
        failOnError: false,
        eventName: 'push',
        eventPath: pushFixture,
        preset: 'text',
        content: 'hello',
      },
      logger: silentLogger(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook' }),
      }),
      sleep: async () => {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.errcode, 93000);
  });
});
