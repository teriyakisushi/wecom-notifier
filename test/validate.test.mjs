import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { ValidationError } from '../src/errors.mjs';
import { assertValidMessage, validateMessage } from '../src/message/validate.mjs';

/* ---------------------------------------------------------------- helpers */

function codes(message) {
  return validateMessage(message).errors.map((item) => item.code);
}

function warningCodes(message) {
  return validateMessage(message).warnings.map((item) => item.code);
}

function expectOk(message, label = '') {
  const result = validateMessage(message);
  assert.deepEqual(result.errors, [], `${label} should be valid: ${JSON.stringify(result.errors)}`);
  return result;
}

function expectCode(message, code, label = '') {
  const found = codes(message);
  assert.ok(found.includes(code), `${label} should report ${code}, got ${JSON.stringify(found)}`);
}

function expectWarning(message, code, label = '') {
  const found = warningCodes(message);
  assert.ok(found.includes(code), `${label} should warn ${code}, got ${JSON.stringify(found)}`);
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function imageBody(bytes) {
  return {
    msgtype: 'image',
    image: {
      base64: bytes.toString('base64'),
      md5: crypto.createHash('md5').update(bytes).digest('hex'),
    },
  };
}

function textCard(overrides = {}) {
  return {
    msgtype: 'template_card',
    template_card: {
      card_type: 'text_notice',
      main_title: { title: '✓ 构建通过' },
      card_action: { type: 1, url: 'https://github.com/teriyakiushi/wecom-notifier/actions' },
      ...overrides,
    },
  };
}

function newsCard(overrides = {}) {
  return {
    msgtype: 'template_card',
    template_card: {
      card_type: 'news_notice',
      main_title: { title: '📦 新版本' },
      card_image: { url: 'https://example.com/a.png', aspect_ratio: 1.78 },
      card_action: { type: 1, url: 'https://github.com/teriyakiushi/wecom-notifier' },
      ...overrides,
    },
  };
}

/* ------------------------------------------------------------ top level */

test('message envelope errors', () => {
  expectCode({ msgtype: 'text' }, 'E_MESSAGE_BODY', 'missing body');
  expectCode({ msgtype: 'miniprogram_notice', miniprogram_notice: {} }, 'E_MSG_TYPE', 'unknown type');
  expectOk({ msgtype: 'text', text: { content: 'hi' } }, 'valid text');
});

test('a non-object message is rejected', () => {
  const result = validateMessage(null);
  assert.deepEqual(result.errors.map((item) => item.code), ['E_MESSAGE']);
});

/* ------------------------------------------------------------------ text */

test('text messages', () => {
  expectOk({ msgtype: 'text', text: { content: 'hello' } });
  expectOk({
    msgtype: 'text',
    text: { content: 'hi', mentioned_list: ['@all'], mentioned_mobile_list: ['13800000000'] },
  });
  expectCode({ msgtype: 'text', text: 'nope' }, 'E_MESSAGE_BODY', 'text body');
  expectCode({ msgtype: 'text', text: {} }, 'E_FIELD_TYPE', 'text.content required');
  expectCode({ msgtype: 'text', text: { content: 42 } }, 'E_FIELD_TYPE', 'text.content type');
  expectCode({ msgtype: 'text', text: { content: '   ' } }, 'E_FIELD_TYPE', 'text.content empty');
  expectCode({ msgtype: 'text', text: { content: 'x'.repeat(2049) } }, 'E_TEXT_TOO_LONG', 'text too long');
  expectCode({ msgtype: 'text', text: { content: 'hi', mentioned_list: 'all' } }, 'E_MENTION', 'mentioned_list type');
  expectCode(
    { msgtype: 'text', text: { content: 'hi', mentioned_mobile_list: [13800000000] } },
    'E_MENTION',
    'mentioned_mobile_list type',
  );
});

/* -------------------------------------------------------------- markdown */

test('markdown and markdown_v2 messages', () => {
  expectOk({ msgtype: 'markdown', markdown: { content: '**bold**' } });
  expectOk({ msgtype: 'markdown_v2', markdown_v2: { content: '- a\n- b' } });
  expectCode({ msgtype: 'markdown', markdown: [] }, 'E_MESSAGE_BODY', 'markdown body');
  expectCode({ msgtype: 'markdown_v2', markdown_v2: {} }, 'E_FIELD_TYPE', 'markdown content required');
  expectCode({ msgtype: 'markdown', markdown: { content: 'x'.repeat(4097) } }, 'E_MARKDOWN_TOO_LONG', 'markdown too long');
});

/* ----------------------------------------------------------------- image */

test('image messages accept JPG and PNG with a matching md5', () => {
  expectOk(imageBody(Buffer.concat([PNG_HEADER, Buffer.from('payload')])), 'png');
  expectOk(imageBody(Buffer.concat([JPG_HEADER, Buffer.from('payload')])), 'jpg');
});

test('image messages report each failure mode', () => {
  expectCode({ msgtype: 'image', image: 'nope' }, 'E_MESSAGE_BODY', 'image body');
  expectCode({ msgtype: 'image', image: { md5: '0'.repeat(32) } }, 'E_FIELD_TYPE', 'base64 required');
  // A non-empty string that decodes to zero bytes reaches the empty-image guard.
  const empty = { msgtype: 'image', image: { base64: '!', md5: '0'.repeat(32) } };
  expectCode(empty, 'E_IMAGE_BASE64', 'empty image');

  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('payload')]);
  expectCode(imageBody(gif), 'E_IMAGE_FORMAT', 'gif');

  const png = Buffer.concat([PNG_HEADER, Buffer.from('payload')]);
  const body = imageBody(png);
  delete body.image.md5;
  expectCode(body, 'E_FIELD_TYPE', 'md5 required');

  expectCode({ ...imageBody(png), image: { ...imageBody(png).image, md5: 'ABC' } }, 'E_IMAGE_MD5', 'md5 format');
  expectCode({ ...imageBody(png), image: { ...imageBody(png).image, md5: 'f'.repeat(32) } }, 'E_IMAGE_MD5_MISMATCH', 'md5 mismatch');

  const big = Buffer.concat([PNG_HEADER, Buffer.alloc(2 * 1024 * 1024 + 1)]);
  expectCode(imageBody(big), 'E_IMAGE_TOO_LARGE', 'too large');
});

/* ------------------------------------------------------------------ news */

test('news messages', () => {
  const article = { title: 'Release 1.0.0', description: 'notes', url: 'https://example.com/a', picurl: 'https://example.com/a.png' };
  expectOk({ msgtype: 'news', news: { articles: [article] } });
  expectOk({ msgtype: 'news', news: { articles: [{ title: 't', url: 'https://example.com' }] } }, 'description optional');

  expectCode({ msgtype: 'news', news: [] }, 'E_MESSAGE_BODY', 'news body');
  expectCode({ msgtype: 'news', news: { articles: {} } }, 'E_NEWS_ARTICLES', 'articles type');
  expectCode({ msgtype: 'news', news: { articles: [] } }, 'E_NEWS_COUNT', 'too few');
  expectCode({ msgtype: 'news', news: { articles: Array.from({ length: 9 }, () => article) } }, 'E_NEWS_COUNT', 'too many');
  expectCode({ msgtype: 'news', news: { articles: ['x'] } }, 'E_ARTICLE', 'article type');
  expectCode({ msgtype: 'news', news: { articles: [{ url: 'https://example.com' }] } }, 'E_FIELD_TYPE', 'title required');
  expectCode(
    { msgtype: 'news', news: { articles: [{ title: 'x'.repeat(129), url: 'https://example.com' }] } },
    'E_ARTICLE_TITLE',
    'title bytes',
  );
  expectCode(
    { msgtype: 'news', news: { articles: [{ title: 't', description: 5, url: 'https://example.com' }] } },
    'E_FIELD_TYPE',
    'description type',
  );
  expectCode(
    { msgtype: 'news', news: { articles: [{ title: 't', description: 'x'.repeat(513), url: 'https://example.com' }] } },
    'E_ARTICLE_DESC',
    'description bytes',
  );
  expectCode({ msgtype: 'news', news: { articles: [{ title: 't' }] } }, 'E_URL_REQUIRED', 'url required');
  expectCode({ msgtype: 'news', news: { articles: [{ title: 't', url: 'ftp://example.com' }] } }, 'E_URL_INVALID', 'url scheme');
  expectCode(
    { msgtype: 'news', news: { articles: [{ title: 't', url: 'https://example.com', picurl: 'not-a-url' }] } },
    'E_URL_INVALID',
    'picurl',
  );
});

/* -------------------------------------------------------------- media */

test('file and voice messages', () => {
  expectOk({ msgtype: 'file', file: { media_id: 'abc' } });
  expectOk({ msgtype: 'voice', voice: { media_id: 'abc' } });
  expectCode({ msgtype: 'file', file: null }, 'E_MESSAGE_BODY', 'file body');
  expectCode({ msgtype: 'voice', voice: {} }, 'E_FIELD_TYPE', 'media_id required');
});

/* ------------------------------------------------------- template_card */

test('template_card envelope', () => {
  expectCode({ msgtype: 'template_card', template_card: null }, 'E_MESSAGE_BODY', 'card body');
  expectCode(textCard({ card_type: 'other' }), 'E_CARD_TYPE', 'card type');
  expectCode(textCard({ card_action: undefined }), 'E_CARD_ACTION', 'action required');
  expectCode(textCard({ card_action: 'x' }), 'E_CARD_ACTION', 'action object');
  expectCode(textCard({ card_action: { type: 3, url: 'https://example.com' } }), 'E_CARD_ACTION_TYPE', 'action type');
  expectCode(textCard({ card_action: { type: 1, url: 'nope' } }), 'E_URL_INVALID', 'action url');
  expectCode(textCard({ card_action: { type: 2 } }), 'E_FIELD_TYPE', 'mini program appid');
  expectOk(textCard({ card_action: { type: 2, appid: 'wx1', pagepath: 'pages/index' } }), 'mini program');
});

test('text_notice content requirements', () => {
  expectCode(textCard({ main_title: undefined }), 'E_CARD_CONTENT', 'title required');
  expectOk(textCard({ main_title: undefined, sub_title_text: '只有副标题' }), 'subtitle is enough');
  expectCode(textCard({ main_title: { title: 42 } }), 'E_FIELD_TYPE', 'title type');
  expectWarning(textCard({ main_title: { title: 'x'.repeat(27) } }), 'W_FIELD_LENGTH', 'title length');
  expectWarning(textCard({ main_title: { title: 'ok', desc: 'x'.repeat(31) } }), 'W_FIELD_LENGTH', 'desc length');
  expectCode(textCard({ main_title: 'nope' }), 'E_MAIN_TITLE', 'main_title type');
  expectCode(textCard({ emphasis_content: 'nope' }), 'E_EMPHASIS', 'emphasis type');
  expectWarning(textCard({ emphasis_content: { title: 'x'.repeat(11) } }), 'W_FIELD_LENGTH', 'emphasis title');
  expectWarning(textCard({ emphasis_content: { desc: 'x'.repeat(16) } }), 'W_FIELD_LENGTH', 'emphasis desc');
  expectCode(textCard({ sub_title_text: 5 }), 'E_FIELD_TYPE', 'subtitle type');
  expectWarning(textCard({ sub_title_text: 'x'.repeat(113) }), 'W_FIELD_LENGTH', 'subtitle length');
});

test('template_card source block', () => {
  expectOk(textCard({ source: { desc: '✓', desc_color: 3 } }));
  expectCode(textCard({ source: 'nope' }), 'E_SOURCE', 'source type');
  expectWarning(textCard({ source: { desc: 'x'.repeat(14) } }), 'W_FIELD_LENGTH', 'source desc length');
  expectCode(textCard({ source: { desc: 5 } }), 'E_FIELD_TYPE', 'source desc type');
  expectCode(textCard({ source: { desc_color: 9 } }), 'E_SOURCE_COLOR', 'source color');
  expectCode(textCard({ source: { icon_url: 'nope' } }), 'E_URL_INVALID', 'source icon');
  expectOk(textCard({ source: { icon_url: 'https://example.com/icon.png' } }), 'source icon ok');
});

test('quote_area variants', () => {
  expectOk(textCard({ quote_area: { quote_text: '一段引用' } }), 'type omitted');
  expectOk(textCard({ quote_area: { type: 0, quote_text: '一段引用' } }), 'type 0');
  expectOk(
    textCard({ quote_area: { type: 1, url: 'https://example.com', title: '标题', quote_text: '正文' } }),
    'type 1',
  );
  expectOk(
    textCard({ quote_area: { type: 2, appid: 'wx1', pagepath: 'pages/a', quote_text: '正文' } }),
    'type 2',
  );
  expectCode(textCard({ quote_area: 'nope' }), 'E_QUOTE', 'quote type');
  expectCode(textCard({ quote_area: { type: 3, quote_text: 'x' } }), 'E_QUOTE_TYPE', 'bad quote type');
  expectCode(textCard({ quote_area: { type: 1, quote_text: 'x' } }), 'E_URL_REQUIRED', 'quote url');
  expectCode(textCard({ quote_area: { type: 2, quote_text: 'x' } }), 'E_FIELD_TYPE', 'quote appid');
  expectCode(textCard({ quote_area: { quote_text: '   ' } }), 'E_FIELD_TYPE', 'quote text empty');
  expectWarning(textCard({ quote_area: { quote_text: 'x'.repeat(501) } }), 'W_FIELD_LENGTH', 'quote length');
  expectWarning(textCard({ quote_area: { title: 'x'.repeat(27), quote_text: 'y' } }), 'W_FIELD_LENGTH', 'quote title');
});

test('horizontal_content_list', () => {
  expectOk(textCard({ horizontal_content_list: [{ keyname: '分支', value: 'main' }] }));
  expectCode(textCard({ horizontal_content_list: {} }), 'E_HORIZONTAL', 'list type');
  expectCode(
    textCard({ horizontal_content_list: Array.from({ length: 7 }, () => ({ keyname: 'k', value: 'v' })) }),
    'E_HORIZONTAL_COUNT',
    'list count',
  );
  expectCode(textCard({ horizontal_content_list: ['x'] }), 'E_HORIZONTAL_ITEM', 'item type');
  expectCode(textCard({ horizontal_content_list: [{ value: 'v' }] }), 'E_FIELD_TYPE', 'keyname required');
  expectCode(textCard({ horizontal_content_list: [{ keyname: 'k', value: 5 }] }), 'E_FIELD_TYPE', 'value type');
  expectWarning(textCard({ horizontal_content_list: [{ keyname: 'k'.repeat(6), value: 'v' }] }), 'W_FIELD_LENGTH', 'keyname length');
  expectWarning(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v'.repeat(27) }] }), 'W_FIELD_LENGTH', 'value length');
  expectCode(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v', type: 1 }] }), 'E_URL_REQUIRED', 'type 1 url');
  expectCode(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v', type: 2 }] }), 'E_FIELD_TYPE', 'type 2 media');
  expectCode(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v', type: 3 }] }), 'E_FIELD_TYPE', 'type 3 userid');
  expectCode(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v', type: 4 }] }), 'E_HORIZONTAL_TYPE', 'type 4');
  expectOk(textCard({ horizontal_content_list: [{ keyname: 'k', value: 'v', type: 3, userid: 'octocat' }] }), 'type 3 ok');
});

test('jump_list', () => {
  expectOk(textCard({ jump_list: [{ title: '详情', type: 1, url: 'https://example.com' }] }));
  expectOk(textCard({ jump_list: [{ title: '纯文本' }] }), 'type omitted');
  expectCode(textCard({ jump_list: {} }), 'E_JUMP', 'list type');
  expectCode(
    textCard({ jump_list: Array.from({ length: 4 }, () => ({ title: 't' })) }),
    'E_JUMP_COUNT',
    'list count',
  );
  expectCode(textCard({ jump_list: ['x'] }), 'E_JUMP_ITEM', 'item type');
  expectCode(textCard({ jump_list: [{ type: 0 }] }), 'E_FIELD_TYPE', 'title required');
  expectWarning(textCard({ jump_list: [{ title: 'x'.repeat(14) }] }), 'W_FIELD_LENGTH', 'title length');
  expectCode(textCard({ jump_list: [{ title: 't', type: 1 }] }), 'E_URL_REQUIRED', 'type 1 url');
  expectOk(textCard({ jump_list: [{ title: 't', type: 2, appid: 'wx1' }] }), 'type 2 pagepath optional');
  expectCode(textCard({ jump_list: [{ title: 't', type: 9 }] }), 'E_JUMP_TYPE', 'type 9');
});

test('image_text_area', () => {
  expectOk(
    textCard({
      image_text_area: {
        type: 1,
        url: 'https://example.com',
        image_url: 'https://example.com/a.png',
        title: '标题',
        desc: '描述',
      },
    }),
  );
  expectOk(
    textCard({ image_text_area: { type: 2, appid: 'wx1', pagepath: 'pages/a', image_url: 'https://example.com/a.png' } }),
    'mini program',
  );
  expectCode(textCard({ image_text_area: 'nope' }), 'E_IMAGE_TEXT_AREA', 'area type');
  expectCode(textCard({ image_text_area: { type: 3 } }), 'E_IMAGE_TEXT_AREA_TYPE', 'area type 3');
  expectCode(textCard({ image_text_area: { type: 1 } }), 'E_URL_REQUIRED', 'area url');
  expectCode(
    textCard({ image_text_area: { type: 1, url: 'https://example.com' } }),
    'E_URL_REQUIRED',
    'area image_url',
  );
  expectCode(textCard({ image_text_area: { type: 2, image_url: 'https://example.com/a.png' } }), 'E_FIELD_TYPE', 'area appid');
  expectWarning(
    textCard({ image_text_area: { type: 1, url: 'https://example.com', image_url: 'https://example.com/a.png', title: 'x'.repeat(27) } }),
    'W_FIELD_LENGTH',
    'area title',
  );
  expectWarning(
    textCard({ image_text_area: { type: 1, url: 'https://example.com', image_url: 'https://example.com/a.png', desc: 'x'.repeat(113) } }),
    'W_FIELD_LENGTH',
    'area desc',
  );
});

test('vertical_content_list', () => {
  expectOk(textCard({ vertical_content_list: [{ title: '结论', desc: '通过' }] }));
  expectCode(textCard({ vertical_content_list: {} }), 'E_VERTICAL', 'list type');
  expectCode(
    textCard({ vertical_content_list: Array.from({ length: 5 }, () => ({ title: 't' })) }),
    'E_VERTICAL_COUNT',
    'list count',
  );
  expectCode(textCard({ vertical_content_list: ['x'] }), 'E_VERTICAL_ITEM', 'item type');
  expectCode(textCard({ vertical_content_list: [{}] }), 'E_FIELD_TYPE', 'title required');
  expectWarning(textCard({ vertical_content_list: [{ title: 'x'.repeat(27) }] }), 'W_FIELD_LENGTH', 'title length');
  expectWarning(textCard({ vertical_content_list: [{ title: 't', desc: 'x'.repeat(113) }] }), 'W_FIELD_LENGTH', 'desc length');
});

test('news_notice requirements', () => {
  expectOk(newsCard());
  expectCode(newsCard({ main_title: undefined }), 'E_CARD_CONTENT', 'title required');
  expectCode(newsCard({ main_title: { title: '  ' } }), 'E_CARD_CONTENT', 'title empty');
  expectCode(newsCard({ card_image: undefined }), 'E_CARD_IMAGE', 'image required');
  expectCode(newsCard({ card_image: { url: 'nope' } }), 'E_URL_INVALID', 'image url');
  expectCode(newsCard({ card_image: { url: 'https://example.com/a.png', aspect_ratio: '1.7' } }), 'E_CARD_IMAGE_RATIO', 'ratio type');
  expectCode(newsCard({ card_image: { url: 'https://example.com/a.png', aspect_ratio: 1.3 } }), 'E_CARD_IMAGE_RATIO', 'ratio lower bound');
  expectCode(newsCard({ card_image: { url: 'https://example.com/a.png', aspect_ratio: 2.25 } }), 'E_CARD_IMAGE_RATIO', 'ratio upper bound');
  expectOk(newsCard({ card_image: { url: 'https://example.com/a.png' } }), 'ratio optional');
});

/* ------------------------------------------------------------ assertion */

test('assertValidMessage throws with issues', () => {
  assert.throws(() => assertValidMessage({ msgtype: 'text', text: {} }), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, 'E_VALIDATION');
    assert.ok(Array.isArray(error.issues) && error.issues.length > 0);
    return true;
  });
  assert.ok(assertValidMessage({ msgtype: 'text', text: { content: 'ok' } }).ok);
});
