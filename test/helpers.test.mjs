import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fitBlock,
  fitText,
  fitTitle,
  infoItem,
  linkItem,
  makeAction,
  makeHorizontalList,
  makeJumpList,
  makeNewsNotice,
  makeSource,
  makeTextNotice,
  parseInfoInput,
  parseLinksInput,
  quoteArea,
  requireHttpUrl,
} from '../src/presets/helpers.mjs';

test('fit helpers collapse newlines and clamp length', () => {
  assert.equal(fitTitle('a\nb'), 'a b');
  assert.equal(fitTitle('x'.repeat(40)).length, 26);
  assert.equal(fitTitle('ok', 2), 'ok');
  assert.equal(fitText(undefined, 5), '');
  assert.equal(fitBlock('  padded  ', 3).length <= 3, true);
  assert.equal(fitBlock('  padded  ', 20), 'padded');
});

test('requireHttpUrl validates and falls back', () => {
  assert.equal(requireHttpUrl('https://example.com', 'x'), 'https://example.com');
  assert.equal(requireHttpUrl(undefined, 'x', 'https://fallback.example'), 'https://fallback.example');
  assert.throws(() => requireHttpUrl('ftp://example.com', 'link-url'), /valid http\(s\) URL/u);
  assert.throws(() => requireHttpUrl(undefined, 'link-url'), (error) => error.code === 'E_URL_REQUIRED');
});

test('makeSource applies defaults and clamps the desc', () => {
  assert.deepEqual(makeSource(), { desc: 'GitHub', desc_color: 0 });
  assert.deepEqual(makeSource({ desc: '', color: '3' }), { desc: 'GitHub', desc_color: 3 });
  assert.equal(makeSource({ desc: 'x'.repeat(20) }).desc.length, 13);
  assert.deepEqual(makeSource({ desc: 'CI', icon: 'https://example.com/i.png' }), {
    desc: 'CI',
    desc_color: 0,
    icon_url: 'https://example.com/i.png',
  });
  assert.equal(makeSource({ icon: 'nope' }).icon_url, undefined);
});

test('makeAction and the item builders', () => {
  assert.deepEqual(makeAction('https://example.com'), { type: 1, url: 'https://example.com' });
  assert.deepEqual(infoItem('分支', 'main'), { keyname: '分支', value: 'main' });
  assert.deepEqual(infoItem('分支', 'main', { type: 1, url: 'https://example.com' }), {
    keyname: '分支',
    value: 'main',
    type: 1,
    url: 'https://example.com',
  });
  assert.deepEqual(linkItem('详情', 'https://example.com'), { title: '详情', url: 'https://example.com' });
});

test('makeJumpList filters, clamps, and infers types', () => {
  const list = makeJumpList([
    null,
    { title: '' },
    { title: '详情', url: 'https://example.com' },
    { title: '小程序', appid: 'wx1', pagepath: 'pages/a' },
    { title: '第四条', url: 'https://example.com' },
    { title: 'x'.repeat(20), url: 'https://example.com' },
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { type: 1, title: '详情', url: 'https://example.com' });
  assert.deepEqual(list[1], { type: 2, title: '小程序', appid: 'wx1', pagepath: 'pages/a' });
  assert.deepEqual(list[2], { type: 1, title: '第四条', url: 'https://example.com' });
  assert.equal(makeJumpList([{ title: 'x'.repeat(20), url: 'https://example.com' }])[0].title.length, 13);
  assert.deepEqual(makeJumpList([]), []);
});

test('makeHorizontalList filters empty values and infers types', () => {
  const list = makeHorizontalList([
    null,
    { keyname: '空', value: '' },
    { keyname: '分支', value: 'main' },
    { keyname: '链接', value: 'https://example.com' },
    { keyname: '用户', value: 'octocat', userid: 'octocat' },
    { keyname: '文件', value: 'file', media_id: 'm1' },
    { keyname: '类型', value: 'v', type: 1, url: 'https://example.com' },
    { keyname: 'x'.repeat(10), value: 'y'.repeat(40) },
  ]);
  assert.equal(list.length, 6);
  assert.deepEqual(list[0], { keyname: '分支', value: 'main' });
  assert.deepEqual(list[1], { keyname: '链接', value: 'https://example.com' });
  assert.deepEqual(list[2], { keyname: '用户', value: 'octocat', type: 3, userid: 'octocat' });
  assert.deepEqual(list[3], { keyname: '文件', value: 'file', type: 2, media_id: 'm1' });
  assert.equal(list[4].type, 1);
  assert.ok(list[5].keyname.length <= 5);
});

test('card builders include optional blocks only when provided', () => {
  const minimal = makeTextNotice({
    source: makeSource(),
    title: '标题',
    action: makeAction('https://example.com'),
  });
  assert.deepEqual(Object.keys(minimal.template_card).sort(), [
    'card_action',
    'card_type',
    'main_title',
    'source',
  ]);

  const full = makeTextNotice({
    source: makeSource(),
    title: '标题',
    desc: '描述',
    emphasis: { title: '42', desc: '次' },
    quote: { quote_text: '引用' },
    subTitle: '副标题',
    horizontal: [{ keyname: 'k', value: 'v' }],
    jump: [{ title: 'j', url: 'https://example.com' }],
    action: makeAction('https://example.com'),
  });
  assert.ok(full.template_card.emphasis_content);
  assert.ok(full.template_card.quote_area);
  assert.equal(full.template_card.sub_title_text, '副标题');
  assert.equal(full.template_card.horizontal_content_list.length, 1);
  assert.equal(full.template_card.jump_list.length, 1);

  const news = makeNewsNotice({
    source: makeSource(),
    title: '标题',
    imageUrl: 'https://example.com/a.png',
    action: makeAction('https://example.com'),
  });
  assert.equal(news.template_card.card_image.aspect_ratio, 1.3);
  assert.ok(!news.template_card.quote_area);

  const fullNews = makeNewsNotice({
    source: makeSource(),
    title: '标题',
    imageUrl: 'https://example.com/a.png',
    action: makeAction('https://example.com'),
    quote: { quote_text: 'q' },
    imageTextArea: { type: 1, url: 'https://example.com', image_url: 'https://example.com/a.png' },
    vertical: [{ title: 'v' }],
    horizontal: [{ keyname: 'k', value: 'v' }],
    jump: [{ title: 'j', url: 'https://example.com' }],
    aspectRatio: 1.78,
  });
  assert.equal(fullNews.template_card.card_image.aspect_ratio, 1.78);
  assert.ok(fullNews.template_card.image_text_area);
  assert.equal(fullNews.template_card.vertical_content_list.length, 1);
});

test('quoteArea returns undefined for blank text', () => {
  assert.equal(quoteArea('   '), undefined);
  assert.deepEqual(quoteArea('a\nb'), { quote_text: 'a b' });
  assert.equal(quoteArea('x'.repeat(600)).quote_text.length, 500);
});

test('parseInfoInput accepts JSON and line formats', () => {
  assert.equal(parseInfoInput(''), undefined);
  assert.deepEqual(parseInfoInput('[{"keyname":"a","value":"b"}]'), [{ keyname: 'a', value: 'b' }]);
  assert.deepEqual(parseInfoInput('分支: main\n用户: octocat'), [
    { keyname: '分支', value: 'main' },
    { keyname: '用户', value: 'octocat' },
  ]);
  assert.deepEqual(
    parseInfoInput('[{"keyname":"a","value":"b","type":1,"url":"https://example.com"}]'),
    [{ keyname: 'a', value: 'b', type: 1, url: 'https://example.com' }],
  );
});

test('parseInfoInput rejects malformed input', () => {
  assert.throws(() => parseInfoInput('[{"keyname":'), (error) => error.code === 'E_CARD_INPUT');
  assert.throws(() => parseInfoInput('{"a":1}'), /must be an array/u);
  assert.throws(() => parseInfoInput('no-colon-here'), /Invalid info line/u);
  assert.throws(
    () => parseInfoInput(Array.from({ length: 7 }, (_, index) => `k${index}: v`).join('\n')),
    /at most 6 rows/u,
  );
  assert.throws(() => parseInfoInput('[1]'), /must be an object/u);
  assert.throws(() => parseInfoInput('[{"value":"v"}]'), /keyname is required/u);
  assert.throws(() => parseInfoInput('[{"keyname":"k"}]'), /value is required/u);
});

test('parseLinksInput accepts JSON and pipe formats', () => {
  assert.equal(parseLinksInput(''), undefined);
  assert.deepEqual(parseLinksInput('[{"title":"a","url":"https://example.com"}]'), [
    { title: 'a', url: 'https://example.com' },
  ]);
  assert.deepEqual(parseLinksInput('详情 | https://example.com'), [
    { title: '详情', url: 'https://example.com' },
  ]);
  assert.deepEqual(parseLinksInput('[{"title":"a","appid":"wx1","pagepath":"p"}]'), [
    { title: 'a', appid: 'wx1', pagepath: 'p' },
  ]);
});

test('parseLinksInput rejects malformed input', () => {
  assert.throws(() => parseLinksInput('[{"title":'), (error) => error.code === 'E_CARD_INPUT');
  assert.throws(() => parseLinksInput('{"a":1}'), /must be an array/u);
  assert.throws(() => parseLinksInput('no-pipe-here'), /Invalid links line/u);
  assert.throws(
    () => parseLinksInput(Array.from({ length: 4 }, (_, index) => `t${index} | https://example.com`).join('\n')),
    /at most 3 rows/u,
  );
  assert.throws(() => parseLinksInput('[1]'), /must be an object/u);
  assert.throws(() => parseLinksInput('[{"url":"https://example.com"}]'), /title is required/u);
});
