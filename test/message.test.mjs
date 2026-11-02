import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { normalizeMessage } from '../src/message/normalize.mjs';
import { truncateMessage } from '../src/message/truncate.mjs';
import { validateMessage } from '../src/message/validate.mjs';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
const PNG_MD5 = crypto.createHash('md5').update(Buffer.from(PNG_BASE64, 'base64')).digest('hex');

function validCard(overrides = {}) {
  return {
    msgtype: 'template_card',
    template_card: {
      card_type: 'text_notice',
      main_title: { title: 'Deploy complete' },
      card_action: { type: 1, url: 'https://example.com/run' },
      ...overrides,
    },
  };
}

test('normalizes aliases and numeric card fields', () => {
  const { message } = normalizeMessage({
    msgtype: 'card_text',
    source: { desc: 'CI', desc_color: '2' },
    main_title: { title: 'Done' },
    card_action: { type: '1', url: 'https://example.com' },
  });

  assert.equal(message.msgtype, 'template_card');
  assert.equal(message.template_card.card_type, 'text_notice');
  assert.equal(message.template_card.source.desc_color, 2);
  assert.equal(message.template_card.card_action.type, 1);
});

test('computes image md5 and warns when a supplied md5 is wrong', () => {
  const good = normalizeMessage({
    msgtype: 'image',
    image: { base64: PNG_BASE64 },
  });
  assert.equal(good.message.image.md5, PNG_MD5);
  assert.deepEqual(good.warnings, []);

  const bad = normalizeMessage({
    msgtype: 'image',
    image: { base64: `data:image/png;base64,${PNG_BASE64}`, md5: '0'.repeat(32) },
  });
  assert.equal(bad.message.image.base64, PNG_BASE64);
  assert.equal(bad.warnings[0]?.code, 'W_IMAGE_MD5');
});

test('truncates only hard text limits and keeps a warning', () => {
  const { message } = normalizeMessage({
    msgtype: 'text',
    text: { content: 'a'.repeat(2100) },
  });
  const result = truncateMessage(message);

  assert.ok(Buffer.byteLength(result.message.text.content, 'utf8') <= 2048);
  assert.equal(result.warnings[0]?.code, 'W_TRUNCATED');
});

test('accepts plain horizontal and jump rows with no type', () => {
  const { message } = normalizeMessage(
    validCard({
      horizontal_content_list: [
        { keyname: '仓库', value: 'owner/demo' },
        { keyname: '文档', url: 'https://example.com/docs' },
      ],
      jump_list: [{ title: '普通文本' }, { title: '查看', url: 'https://example.com' }],
    }),
  );

  const validation = validateMessage(message);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(message.template_card.horizontal_content_list[0].type, undefined);
  assert.equal(message.template_card.jump_list[0].type, undefined);
  assert.equal(message.template_card.horizontal_content_list[1].type, 1);
  assert.equal(message.template_card.jump_list[1].type, 1);
});

test('rejects a typed horizontal row without its required field', () => {
  const { message } = normalizeMessage(
    validCard({ horizontal_content_list: [{ type: 1, keyname: '文档' }] }),
  );
  const validation = validateMessage(message);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((issue) => issue.code === 'E_URL_REQUIRED'));
});

test('rejects too many news articles and missing card actions', () => {
  const news = normalizeMessage({
    msgtype: 'news',
    news: {
      articles: Array.from({ length: 9 }, (_, index) => ({
        title: `Article ${index}`,
        url: 'https://example.com',
      })),
    },
  }).message;
  assert.equal(validateMessage(news).ok, false);

  const card = validCard();
  delete card.template_card.card_action;
  const normalized = normalizeMessage(card).message;
  assert.equal(validateMessage(normalized).ok, false);
});

test('accepts a complete news_notice card', () => {
  const { message } = normalizeMessage({
    msgtype: 'card_news',
    card_news: {
      main_title: { title: 'Release' },
      card_image: { url: 'https://example.com/cover.png', aspect_ratio: '1.5' },
      card_action: { type: 1, url: 'https://example.com/release' },
    },
  });
  assert.equal(message.template_card.card_type, 'news_notice');
  assert.equal(message.template_card.card_image.aspect_ratio, 1.5);
  assert.equal(validateMessage(message).ok, true);
});
