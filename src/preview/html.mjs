import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isPlainObject } from '../util.mjs';

/**
 * A dependency-free HTML preview of a rendered WeCom message.
 *
 * The goal is not pixel-perfect parity with the WeCom client; it is a fast,
 * offline way to see what a template actually produced: which branches were
 * pruned, whether the text was truncated, and how a card is composed.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ESCAPES[char]);
}

function attr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

function isUrl(value) {
  if (typeof value !== 'string') return false;
  if (/^https?:\/\//iu.test(value)) return true;
  if (/^data:image\/[a-z+]+;base64,/iu.test(value)) return true;
  return false;
}

function link(href, label, className = '') {
  if (!isUrl(href)) return escapeHtml(label ?? href);
  return `<a class="${className}" href="${attr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label ?? href)}</a>`;
}

/**
 * Render the small markdown dialect WeCom accepts (markdown / markdown_v2).
 */
export function renderMarkdown(text) {
  const source = String(text ?? '');
  const lines = source.split(/\r?\n/u);
  const out = [];
  let listOpen = false;
  let inFence = false;
  let fenceLines = [];

  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  const inline = (value) =>
    escapeHtml(value)
      .replace(/`([^`]+)`/gu, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/gu, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_match, label, href) =>
        isUrl(href) ? `<a href="${attr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label,
      )
      .replace(
        /&lt;font color=(?:"|&quot;)(info|comment|warning)(?:"|&quot;)&gt;([\s\S]*?)&lt;\/font&gt;/gu,
        (_match, tone, body) => `<span class="tone-${tone}">${body}</span>`,
      );

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inFence) {
        out.push(`<pre class="code"><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
        fenceLines = [];
        inFence = false;
      } else {
        closeList();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/u.test(line.trim())) {
      closeList();
      out.push('<hr />');
      continue;
    }
    const quote = /^>\s?(.*)$/u.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line);
    if (bullet) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inFence && fenceLines.length > 0) {
    out.push(`<pre class="code"><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
}

function renderTextBody(content) {
  return `<div class="bubble text"><div class="prewrap">${escapeHtml(content)}</div></div>`;
}

function renderNews(articles) {
  const items = Array.isArray(articles) ? articles : [];
  const cards = items
    .map((article) => {
      const raw = isPlainObject(article) ? article : {};
      const pic = isUrl(raw.picurl)
        ? `<img class="news-pic" src="${attr(raw.picurl)}" alt="" loading="lazy" />`
        : '<div class="news-pic placeholder">无图</div>';
      return `<article class="news-card">
  ${pic}
  <div class="news-body">
    <h3>${escapeHtml(raw.title ?? '')}</h3>
    ${raw.description ? `<p>${escapeHtml(raw.description)}</p>` : ''}
    ${isUrl(raw.url) ? link(raw.url, '阅读原文', 'news-link') : ''}
  </div>
</article>`;
    })
    .join('\n');
  return `<div class="bubble news"><div class="app-name">图文消息 · ${items.length} 条</div>${cards}</div>`;
}

function renderHorizontalList(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const rows = list
    .map((entry) => {
      const raw = isPlainObject(entry) ? entry : {};
      const value = raw.value
        ? isUrl(raw.value)
          ? link(raw.value, raw.value)
          : escapeHtml(raw.value)
        : escapeHtml(raw.value);
      return `<div class="kv"><span class="k">${escapeHtml(raw.keyname ?? raw.key ?? '')}</span><span class="v">${value}</span></div>`;
    })
    .join('');
  return `<div class="kv-list">${rows}</div>`;
}

function renderVerticalList(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const rows = list
    .map((entry) => {
      const raw = isPlainObject(entry) ? entry : {};
      const body = raw.desc ? `<p>${escapeHtml(raw.desc)}</p>` : '';
      return `<section class="vitem"><h4>${escapeHtml(raw.title ?? '')}</h4>${body}</section>`;
    })
    .join('');
  return `<div class="v-list">${rows}</div>`;
}

function renderJumpList(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const rows = list
    .map((entry) => {
      const raw = isPlainObject(entry) ? entry : {};
      const label = escapeHtml(raw.title ?? '打开');
      return `<li>${isUrl(raw.url) ? link(raw.url, label) : label}<span class="type">${escapeHtml(raw.type ?? '')}</span></li>`;
    })
    .join('');
  return `<ul class="jump-list">${rows}</ul>`;
}

function renderQuoteArea(quote) {
  if (!isPlainObject(quote) || !quote.quote_text) return '';
  const title = quote.title ? `<div class="quote-title">${escapeHtml(quote.title)}</div>` : '';
  return `<div class="quote">
  <div class="quote-bar"></div>
  <div class="quote-body">${title}<div class="prewrap">${escapeHtml(quote.quote_text)}</div></div>
</div>`;
}

function renderSource(source) {
  if (!isPlainObject(source)) return '';
  const color = Number.isInteger(source.desc_color) ? `tone-${source.desc_color}` : '';
  return `<div class="card-source ${color}">${escapeHtml(source.desc ?? '')}</div>`;
}

function renderTextNotice(card) {
  const emphasis = isPlainObject(card.emphasis_content)
    ? `<div class="emphasis"><span class="num">${escapeHtml(card.emphasis_content.title ?? '')}</span><span class="sub">${escapeHtml(card.emphasis_content.desc ?? '')}</span></div>`
    : '';
  const action = isPlainObject(card.card_action) && card.card_action.url
    ? `<div class="card-action">${link(card.card_action.url, '查看详情')}</div>`
    : '';
  return `<div class="bubble card">
  <div class="card-head">${escapeHtml(card.main_title?.title ?? '')}${renderSource(card.source)}</div>
  ${card.main_title?.desc ? `<p class="card-sub">${escapeHtml(card.main_title.desc)}</p>` : ''}
  ${emphasis}
  ${card.sub_title_text ? `<div class="card-subtitle">${escapeHtml(card.sub_title_text)}</div>` : ''}
  ${renderHorizontalList(card.horizontal_content_list)}
  ${renderJumpList(card.jump_list)}
  ${action}
</div>`;
}

function renderNewsNotice(card) {
  const image = isPlainObject(card.card_image) && isUrl(card.card_image.url)
    ? `<div class="card-image"><img src="${attr(card.card_image.url)}" alt="" loading="lazy" /></div>`
    : '<div class="card-image placeholder">card_image 为空</div>';
  const textArea = isPlainObject(card.image_text_area)
    ? `<div class="image-text">
  <h4>${escapeHtml(card.image_text_area.title ?? '')}</h4>
  ${card.image_text_area.desc ? `<p>${escapeHtml(card.image_text_area.desc)}</p>` : ''}
</div>`
    : '';
  const action = isPlainObject(card.card_action) && card.card_action.url
    ? `<div class="card-action">${link(card.card_action.url, '查看详情')}</div>`
    : '';
  return `<div class="bubble card news-notice">
  ${image}
  <div class="card-head">${escapeHtml(card.main_title?.title ?? '')}${renderSource(card.source)}</div>
  ${card.main_title?.desc ? `<p class="card-sub">${escapeHtml(card.main_title.desc)}</p>` : ''}
  ${textArea}
  ${renderVerticalList(card.vertical_content_list)}
  ${renderQuoteArea(card.quote_area)}
  ${renderJumpList(card.jump_list)}
  ${action}
</div>`;
}

function renderTemplateCard(card) {
  if (!isPlainObject(card)) return '<div class="bubble card">template_card 为空</div>';
  if (card.card_type === 'news_notice') return renderNewsNotice(card);
  return renderTextNotice(card);
}

function renderImageBody(image) {
  const base64 = image?.base64;
  const md5 = image?.md5;
  if (!base64) return '<div class="bubble card">image 缺少 base64</div>';
  const dataUrl = `data:image/png;base64,${base64}`;
  return `<div class="bubble card"><div class="card-image"><img src="${attr(dataUrl)}" alt="" /></div>
  <div class="kv-list"><div class="kv"><span class="k">md5</span><span class="v">${escapeHtml(md5 ?? '')}</span></div></div></div>`;
}

function renderBody(message) {
  switch (message.msgtype) {
    case 'text':
      return renderTextBody(message.text?.content ?? '');
    case 'markdown':
    case 'markdown_v2':
      return `<div class="bubble markdown">${renderMarkdown(message[message.msgtype]?.content ?? '')}</div>`;
    case 'news':
      return renderNews(message.news?.articles);
    case 'template_card':
      return renderTemplateCard(message.template_card);
    case 'image':
      return renderImageBody(message.image);
    default:
      return `<div class="bubble card"><div class="unknown">未支持的 msgtype: ${escapeHtml(message.msgtype ?? '')}</div>
  <pre class="code">${escapeHtml(JSON.stringify(message, null, 2))}</pre></div>`;
  }
}

function warningRows(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return '<p class="ok">无 warning</p>';
  }
  return `<ul class="warnings">${warnings
    .map(
      (warning) =>
        `<li><code>${escapeHtml(warning.code ?? 'W')}</code> <span class="path">${escapeHtml(warning.path ?? '')}</span><div>${escapeHtml(warning.message ?? '')}</div></li>`,
    )
    .join('')}</ul>`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f2f3f5;
  --panel: #ffffff;
  --ink: #1a1a1a;
  --muted: #6b7280;
  --line: #e5e7eb;
  --accent: #07c160;
  --bubble: #ffffff;
  --shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111315;
    --panel: #1a1d21;
    --ink: #e8eaed;
    --muted: #9aa0a6;
    --line: #2c3035;
    --bubble: #23262b;
    --shadow: 0 1px 3px rgba(0,0,0,.5);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px 20px 60px;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
header.page { max-width: 1080px; margin: 0 auto 18px; display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: baseline; }
header.page h1 { font-size: 16px; margin: 0; font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 12px; }
.meta code { color: var(--ink); }
.layout { max-width: 1080px; margin: 0 auto; display: grid; gap: 20px; grid-template-columns: minmax(0, 380px) minmax(0, 1fr); }
@media (max-width: 860px) { .layout { grid-template-columns: minmax(0, 1fr); } }
.phone { background: var(--panel); border-radius: 22px; padding: 18px 14px; box-shadow: var(--shadow); }
.phone-head { display: flex; align-items: center; gap: 8px; padding: 0 4px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.chat { padding-top: 14px; display: flex; flex-direction: column; gap: 12px; }
.bubble { background: var(--bubble); border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.prewrap { white-space: pre-wrap; word-break: break-word; }
.markdown p { margin: 0 0 6px; }
.markdown p:last-child { margin-bottom: 0; }
.markdown .md-h { margin: 4px 0 8px; font-size: 15px; }
.markdown code, .code { background: rgba(127,127,127,.14); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.markdown pre.code { padding: 10px; overflow: auto; }
.markdown blockquote { margin: 6px 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--line); color: var(--muted); }
.markdown ul { margin: 4px 0; padding-left: 18px; }
.tone-info { color: #3b82f6; }
.tone-comment { color: var(--muted); }
.tone-warning { color: #ef4444; }
.news-card { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-top: 10px; }
.news-card:first-of-type { margin-top: 6px; }
.news-pic { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: rgba(127,127,127,.12); }
.news-pic.placeholder, .card-image.placeholder { display: grid; place-items: center; color: var(--muted); font-size: 12px; }
.news-body { padding: 10px 12px 12px; }
.news-body h3 { font-size: 14px; margin: 0 0 6px; }
.news-body p { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
.news-link, .card-action a, .jump-list a { color: var(--accent); text-decoration: none; }
.app-name { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.card { padding: 0; overflow: hidden; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 0; font-weight: 600; }
.card-source { font-size: 11px; font-weight: 400; color: var(--muted); }
.card-source.tone-2 { color: #ef4444; }
.card-source.tone-3 { color: var(--accent); }
.card-sub { margin: 4px 14px 0; color: var(--muted); font-size: 12px; }
.card-subtitle { margin: 10px 14px 0; font-size: 12px; color: var(--muted); }
.emphasis { margin: 10px 14px 0; display: flex; align-items: baseline; gap: 8px; }
.emphasis .num { font-size: 22px; font-weight: 600; }
.emphasis .sub { color: var(--muted); font-size: 12px; }
.kv-list { margin: 10px 14px 0; border-top: 1px solid var(--line); }
.kv { display: flex; gap: 12px; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { text-align: right; word-break: break-all; }
.v-list { margin: 10px 14px 0; }
.vitem h4 { margin: 0; font-size: 13px; }
.vitem p { margin: 2px 0 8px; color: var(--muted); font-size: 12px; }
.quote { display: flex; gap: 10px; margin: 12px 14px 0; }
.quote-bar { width: 3px; border-radius: 2px; background: var(--line); }
.quote-title { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.quote-body { font-size: 12px; }
.card-image img { display: block; width: 100%; max-height: 320px; object-fit: cover; }
.image-text { padding: 10px 14px 0; }
.image-text h4 { margin: 0 0 4px; font-size: 13px; }
.image-text p { margin: 0; color: var(--muted); font-size: 12px; }
.jump-list { list-style: none; margin: 10px 14px 0; padding: 0; border-top: 1px solid var(--line); }
.jump-list li { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12px; }
.jump-list .type { color: var(--muted); }
.card-action { margin: 12px 14px 14px; }
.card-action a { display: block; text-align: center; padding: 8px; border-radius: 8px; background: rgba(7,193,96,.1); font-size: 13px; }
.panel { background: var(--panel); border-radius: 16px; padding: 18px; box-shadow: var(--shadow); min-width: 0; }
.panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; }
.panel + .panel { margin-top: 16px; }
pre.raw { margin: 0; padding: 12px; background: rgba(127,127,127,.08); border-radius: 10px; overflow: auto; max-height: 460px; font-size: 12px; }
.warnings { margin: 0; padding-left: 18px; font-size: 12px; }
.warnings li { margin-bottom: 8px; }
.warnings .path { color: var(--muted); }
.ok { color: var(--accent); font-size: 12px; margin: 0; }
.unknown { font-size: 12px; color: #ef4444; margin-bottom: 8px; }
footer.page { max-width: 1080px; margin: 26px auto 0; color: var(--muted); font-size: 11px; }
`;

/**
 * Build the full preview document.
 *
 * @param {{message: object, eventName?: string, origin?: string, warnings?: object[], bytes?: number, generatedAt?: Date}} options
 */
export function renderPreviewHtml({ message, eventName = '', origin = '', warnings = [], bytes, generatedAt = new Date() } = {}) {
  const body = renderBody(isPlainObject(message) ? message : {});
  const raw = JSON.stringify(message ?? {}, null, 2);
  const size = bytes ?? Buffer.byteLength(raw, 'utf8');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>wecom-notifier preview · ${escapeHtml(message?.msgtype ?? 'message')}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="page">
  <h1>wecom-notifier preview</h1>
  <div class="meta">
    <span>event <code>${escapeHtml(eventName || 'unknown')}</code></span>
    <span>origin <code>${escapeHtml(origin || '-')}</code></span>
    <span>msgtype <code>${escapeHtml(message?.msgtype ?? '-')}</code></span>
    <span><code>${size}</code> bytes</span>
    <span><code>${warnings.length}</code> warning(s)</span>
  </div>
</header>
<main class="layout">
  <section class="phone">
    <div class="phone-head"><span class="dot"></span>企业微信 · 本地预览</div>
    <div class="chat">${body}</div>
  </section>
  <div>
    <section class="panel">
      <h2>Warnings</h2>
      ${warningRows(warnings)}
    </section>
    <section class="panel">
      <h2>Payload</h2>
      <pre class="raw">${escapeHtml(raw)}</pre>
    </section>
  </div>
</main>
<footer class="page">generated ${escapeHtml(generatedAt.toISOString())} · 仅本地预览，字段上限与客户端渲染以企业微信为准</footer>
</body>
</html>
`;
}

/**
 * Write the preview next to the project (creating parent directories).
 * @returns {string} absolute path
 */
export function writePreviewHtml({ file, cwd = process.cwd(), ...options }) {
  const target = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, renderPreviewHtml(options), 'utf8');
  return target;
}
