import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_EVENT_PRESETS,
  BUILTIN_PRESETS,
  PRESET_NAMES,
  describePreset,
  getPreset,
  resolvePresetName,
} from '../src/presets/index.mjs';
import { buildContext } from '../src/context.mjs';
import { readFileSync } from 'node:fs';

const pushEvent = JSON.parse(
  readFileSync(new URL('../tests/fixtures/events/push.json', import.meta.url), 'utf8'),
);

const ctx = buildContext({ eventName: 'push', event: pushEvent, env: {}, inputs: {} });

test('the preset registry exposes every builtin once', () => {
  assert.equal(PRESET_NAMES[0], 'auto');
  assert.deepEqual(
    [...PRESET_NAMES].sort(),
    ['auto', ...Object.keys(BUILTIN_PRESETS)].sort(),
  );
  for (const name of Object.keys(BUILTIN_PRESETS)) {
    assert.equal(typeof BUILTIN_PRESETS[name], 'function', `${name} should be a factory`);
  }
});

test('auto resolves through the event map and falls back to generic', () => {
  assert.equal(resolvePresetName('auto', 'push'), 'push');
  assert.equal(resolvePresetName(undefined, 'pull_request'), 'pull_request');
  assert.equal(resolvePresetName('  ', 'pull_request'), 'pull_request');
  assert.equal(resolvePresetName('auto', 'workflow_dispatch'), 'generic');
  assert.equal(resolvePresetName('auto', undefined), 'generic');
  assert.deepEqual(Object.keys(AUTO_EVENT_PRESETS).length > 0, true);
});

test('explicit presets pass through and unknown names fail', () => {
  assert.equal(resolvePresetName('card', 'push'), 'card');
  assert.throws(() => resolvePresetName('nope', 'push'), (error) => {
    assert.equal(error.code, 'E_PRESET_UNKNOWN');
    assert.match(error.hint, /auto, push/u);
    return true;
  });
});

test('describePreset only annotates auto resolution', () => {
  assert.equal(describePreset('auto', 'push'), 'auto -> push');
  assert.equal(describePreset('push', 'push'), 'push');
});

test('getPreset requires a context object', () => {
  assert.throws(() => getPreset('push'), (error) => error.code === 'E_PRESET_CONTEXT');
  assert.throws(() => getPreset('push', {}), (error) => error.code === 'E_PRESET_CONTEXT');
});

test('getPreset falls back to the context event when no name is given', () => {
  const message = getPreset('auto', { ctx });
  assert.equal(message.msgtype, 'template_card');
  assert.ok(message.template_card.card_action.url);
});

test('the none preset renders nothing', () => {
  assert.deepEqual(getPreset('none', { ctx }), {});
});

test('simple presets carry the content input', () => {
  assert.deepEqual(getPreset('text', { ctx, inputs: { content: ' hello ' } }), {
    msgtype: 'text',
    text: { content: 'hello' },
  });
  assert.deepEqual(getPreset('markdown', { ctx, inputs: { content: '**hi**' } }), {
    msgtype: 'markdown',
    markdown: { content: '**hi**' },
  });
  for (const name of ['text', 'markdown']) {
    assert.throws(() => getPreset(name, { ctx, inputs: {} }), (error) => {
      assert.equal(error.code, 'E_PRESET_CONTENT');
      assert.equal(error.path, 'content');
      return true;
    });
  }
});

test('the card preset builds a text_notice by default', () => {
  const message = getPreset('card', {
    ctx,
    inputs: {
      title: '标题',
      subtitle: '副标题',
      content: '正文',
      info: '分支: main\n用户: octocat',
      links: '详情 | https://example.com/run',
      source: 'CI',
      sourceColor: '3',
    },
  });
  assert.equal(message.msgtype, 'template_card');
  assert.equal(message.template_card.card_type, 'text_notice');
  assert.equal(message.template_card.main_title.title, '标题');
  assert.equal(message.template_card.sub_title_text, '正文');
  assert.equal(message.template_card.horizontal_content_list.length, 2);
  assert.equal(message.template_card.jump_list[0].url, 'https://example.com/run');
  assert.equal(message.template_card.source.desc_color, 3);
  assert.equal(message.template_card.card_action.url, 'https://example.com/run');
});

test('the card preset switches to news_notice when an image is given', () => {
  const message = getPreset('card', {
    ctx,
    inputs: {
      title: '标题',
      subtitle: '副标题',
      imageUrl: 'https://example.com/cover.png',
      linkUrl: 'https://example.com/run',
      linkTitle: '去查看',
      info: '分支: main',
    },
  });
  assert.equal(message.template_card.card_type, 'news_notice');
  assert.equal(message.template_card.card_image.url, 'https://example.com/cover.png');
  assert.equal(message.template_card.image_text_area.title, '标题');
  assert.equal(message.template_card.jump_list[0].title, '去查看');
});

test('the card preset needs a usable link url', () => {
  assert.throws(
    () => getPreset('card', { ctx: { event_name: 'workflow_dispatch' }, inputs: {} }),
    (error) => error.code === 'E_URL_REQUIRED',
  );
});
