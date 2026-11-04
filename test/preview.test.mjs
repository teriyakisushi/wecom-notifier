import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { escapeHtml, renderMarkdown, renderPreviewHtml, writePreviewHtml } from '../src/preview/html.mjs';

const warnings = [
  { code: 'W_FIELD_LENGTH', path: 'template_card.main_title.title', message: 'title is longer than 26 characters' },
];

test('text messages are escaped inside the bubble', () => {
  const html = renderPreviewHtml({
    message: { msgtype: 'text', text: { content: '<script>alert(1)</script> & "quotes"' } },
    eventName: 'push',
    origin: 'inline message',
  });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('event <code>push</code>'));
  assert.ok(html.includes('origin <code>inline message</code>'));
  assert.ok(html.includes('<code>0</code> warning(s)'));
});

test('markdown rendering covers the supported dialect', () => {
  const html = renderMarkdown(
    [
      '# 标题',
      '',
      '**bold** 和 *italic* 以及 `code`',
      '',
      '- 第一项',
      '- 第二项',
      '',
      '> 引用',
      '',
      '[链接](https://example.com) 与 [坏链接](javascript:alert(1))',
      '',
      '<font color="warning">警告</font>',
      '',
      '```js',
      'const a = 1 < 2;',
      '```',
      '',
      '---',
    ].join('\n'),
  );
  assert.ok(html.includes('<h3 class="md-h">标题</h3>'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<em>italic</em>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('<li>第一项</li>'));
  assert.ok(html.includes('<blockquote>引用</blockquote>'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('坏链接') && !html.includes('javascript:alert'));
  assert.ok(html.includes('class="tone-warning"'));
  assert.ok(html.includes('const a = 1 &lt; 2;'));
  assert.ok(html.includes('<hr />'));
});

test('markdown_v2 messages are rendered through the markdown pipeline', () => {
  const html = renderPreviewHtml({
    message: { msgtype: 'markdown_v2', markdown_v2: { content: '**hi**' } },
    warnings,
  });
  assert.ok(html.includes('<strong>hi</strong>'));
  assert.ok(html.includes('W_FIELD_LENGTH'));
  assert.ok(html.includes('<code>1</code> warning(s)'));
});

test('news messages render article cards, with and without pictures', () => {
  const html = renderPreviewHtml({
    message: {
      msgtype: 'news',
      news: {
        articles: [
          { title: '有图', description: '描述', url: 'https://example.com/a', picurl: 'https://example.com/a.png' },
          { title: '无图', url: 'https://example.com/b' },
        ],
      },
    },
  });
  assert.ok(html.includes('图文消息 · 2 条'));
  assert.ok(html.includes('src="https://example.com/a.png"'));
  assert.ok(html.includes('无图'));
  assert.ok(html.includes('阅读原文'));
});

test('text_notice cards render title, emphasis, lists and action', () => {
  const html = renderPreviewHtml({
    message: {
      msgtype: 'template_card',
      template_card: {
        card_type: 'text_notice',
        source: { desc: 'CI', desc_color: 3 },
        main_title: { title: '构建通过', desc: 'main' },
        emphasis_content: { title: '42', desc: '次提交' },
        sub_title_text: '副标题',
        horizontal_content_list: [
          { keyname: '分支', value: 'main' },
          { keyname: '链接', value: 'https://example.com' },
        ],
        jump_list: [{ title: '详情', url: 'https://example.com/run', type: 1 }],
        card_action: { type: 1, url: 'https://example.com/run' },
      },
    },
  });
  assert.ok(html.includes('构建通过'));
  assert.ok(html.includes('class="emphasis"'));
  assert.ok(html.includes('42'));
  assert.ok(html.includes('副标题'));
  assert.ok(html.includes('<span class="k">分支</span>'));
  assert.ok(html.includes('class="jump-list"'));
  assert.ok(html.includes('查看详情'));
  assert.ok(html.includes('card-source tone-3'));
});

test('news_notice cards render every block', () => {
  const html = renderPreviewHtml({
    message: {
      msgtype: 'template_card',
      template_card: {
        card_type: 'news_notice',
        main_title: { title: '新版本', desc: 'v1.0.0' },
        source: { desc: '发布' },
        card_image: { url: 'https://example.com/cover.png', aspect_ratio: 1.78 },
        image_text_area: { type: 1, title: '封面标题', desc: '封面描述', url: 'https://example.com' },
        vertical_content_list: [{ title: '结论', desc: '成功' }],
        quote_area: { type: 1, title: '引用标题', quote_text: '引用正文' },
        jump_list: [{ title: '发布页', url: 'https://example.com/release' }],
        card_action: { type: 1, url: 'https://example.com' },
      },
    },
  });
  assert.ok(html.includes('src="https://example.com/cover.png"'));
  assert.ok(html.includes('封面标题'));
  assert.ok(html.includes('fill class="vitem"') || html.includes('class="vitem"'));
  assert.ok(html.includes('引用正文'));
  assert.ok(html.includes('class="quote"'));
});

test('empty card blocks degrade gracefully', () => {
  const html = renderPreviewHtml({
    message: {
      msgtype: 'template_card',
      template_card: { card_type: 'news_notice', card_image: { url: '' } },
    },
  });
  assert.ok(html.includes('card_image 为空'));

  const empty = renderPreviewHtml({ message: { msgtype: 'template_card', template_card: null } });
  assert.ok(empty.includes('template_card 为空'));
});

test('image messages embed the base64 payload', () => {
  const html = renderPreviewHtml({
    message: { msgtype: 'image', image: { base64: 'AAAA', md5: 'd41d8cd98f00b204e9800998ecf8427e' } },
  });
  assert.ok(html.includes('data:image/png;base64,AAAA'));
  assert.ok(html.includes('d41d8cd98f00b204e9800998ecf8427e'));

  const missing = renderPreviewHtml({ message: { msgtype: 'image', image: {} } });
  assert.ok(missing.includes('image 缺少 base64'));
});

test('unknown message types fall back to the raw payload', () => {
  const html = renderPreviewHtml({ message: { msgtype: 'miniprogram_notice', miniprogram_notice: { a: 1 } } });
  assert.ok(html.includes('未支持的 msgtype: miniprogram_notice'));
  assert.ok(html.includes('&quot;a&quot;: 1'));
});

test('the document is self contained and reports size and warnings', () => {
  const message = { msgtype: 'text', text: { content: 'hello' } };
  const html = renderPreviewHtml({ message, warnings, eventName: 'push', origin: 'preset' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<style>'));
  assert.ok(!html.includes('<script'));
  const bytes = Buffer.byteLength(JSON.stringify(message, null, 2), 'utf8');
  assert.ok(html.includes(`<code>${bytes}</code> bytes`));
  assert.ok(html.includes('W_FIELD_LENGTH'));
});

test('writePreviewHtml creates parent directories', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wecom-preview-'));
  const target = path.join(dir, 'nested', 'deep', 'preview.html');
  const written = writePreviewHtml({ file: target, message: { msgtype: 'text', text: { content: 'x' } } });
  assert.equal(written, target);
  assert.ok(statSync(target).size > 0);
  assert.ok(readFileSync(target, 'utf8').includes('wecom-notifier preview'));
  rmSync(dir, { recursive: true, force: true });
});

test('escapeHtml handles every escaped character', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(undefined), '');
});
