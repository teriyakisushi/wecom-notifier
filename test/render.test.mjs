import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMessage } from '../src/template/render.mjs';

const context = {
  repo: { name: 'demo' },
  count: 2,
  commits: [
    { short_sha: 'aaa111', first_line: 'feat: one' },
    { short_sha: 'bbb222', first_line: 'fix: two' },
  ],
  missing: undefined,
};

test('renders nested objects and arrays', () => {
  const result = renderMessage(
    {
      title: '{{ repo.name }}',
      rows: [{ key: 'count', value: '{{ count }}' }],
    },
    context,
  );
  assert.deepEqual(result.value, {
    title: 'demo',
    rows: [{ key: 'count', value: 2 }],
  });
  assert.deepEqual(result.warnings, []);
});

test('$if drops the object when the condition is false', () => {
  const result = renderMessage(
    {
      keep: { $if: 'count > 1', value: '{{ count }}' },
      drop: { $if: 'count > 10', value: 'nope' },
    },
    context,
  );
  assert.deepEqual(result.value, { keep: { value: 2 } });
});

test('$each renders, aliases, limits, and joins items', () => {
  const result = renderMessage(
    {
      content: {
        $each: 'commits',
        $as: 'commit',
        $item: '- {{ commit.short_sha }} {{ commit.first_line }}',
        $join: '\n',
        $limit: 1,
      },
    },
    context,
  );
  assert.deepEqual(result.value, { content: '- aaa111 feat: one' });
  assert.equal(result.warnings[0]?.code, 'W_EACH_LIMIT');
});

test('$each can build an array of objects', () => {
  const result = renderMessage(
    {
      commits: {
        $each: 'commits',
        $item: { sha: '{{ item.short_sha }}' },
      },
    },
    context,
  );
  assert.deepEqual(result.value, {
    commits: [{ sha: 'aaa111' }, { sha: 'bbb222' }],
  });
});

test('invalid directives fail loudly', () => {
  assert.throws(
    () => renderMessage({ value: { $bogus: 'x' } }, context),
    /Unknown directive/,
  );
  assert.throws(
    () => renderMessage({ value: { $each: 'commits' } }, context),
    /\$each requires a sibling \$item/,
  );
});

/* ------------------------------------------------ readable aliases (D1) */

test('when is an alias for $if', () => {
  const result = renderMessage(
    {
      rows: [
        { when: 'count > 1', text: 'many' },
        { when: 'count > 5', text: 'lots' },
        { when: 'count > 0', text: 'some' },
      ],
    },
    context,
  );
  assert.deepEqual(result.value, { rows: [{ text: 'many' }, { text: 'some' }] });
});

test('for/item/as/limit/join are aliases for $each directives', () => {
  const result = renderMessage(
    { list: { for: 'commits', as: 'c', item: '{{ c.short_sha }}', join: '/', limit: 1 } },
    context,
  );
  assert.deepEqual(result.value, { list: 'aaa111' });
});

test('aliases can nest and mix with the $ spelling', () => {
  const result = renderMessage(
    {
      rows: {
        for: 'commits',
        item: { $if: 'item.short_sha == "aaa111"', text: '{{ item.first_line }}' },
      },
      many: { when: 'count > 1', text: 'yes' },
    },
    context,
  );
  assert.deepEqual(result.value, { rows: [{ text: 'feat: one' }], many: { text: 'yes' } });
});

test('mixing the two spellings of one directive fails', () => {
  assert.throws(() => renderMessage({ a: { when: 'count > 0', $if: 'count > 0' } }, context), /either "when" or "\$if"/u);
  assert.throws(() => renderMessage({ a: { for: 'commits', $each: 'commits', item: 'x' } }, context), /either "for" or "\$each"/u);
});

test('for rejects stray fields and a missing item', () => {
  assert.throws(() => renderMessage({ a: { for: 'commits', item: 'x', title: 'nope' } }, context), /cannot sit next to "for"/u);
  assert.throws(() => renderMessage({ a: { for: 'commits' } }, context), /requires an "item" template/u);
});

test('for and when cannot share an object', () => {
  assert.throws(() => renderMessage({ a: { for: 'commits', item: 'x', when: 'count > 0' } }, context), /cannot sit next to "for"/u);
  assert.throws(() => renderMessage({ a: { $each: 'commits', $item: 'x', $if: 'count > 0' } }, context), /cannot be combined/u);
});

/* -------------------------------------------------- variants sugar (D3) */

const variantTemplate = {
  card: {
    card_type: 'text_notice',
    main_title: { title: '共享标题' },
    variants: {
      by: 'status',
      cases: {
        ok: { source: { desc: '成功', desc_color: 3 } },
        bad: { source: { desc: '失败', desc_color: 2 }, main_title: { title: '覆盖标题' } },
      },
      default: { source: { desc: '未知', desc_color: 1 } },
    },
  },
};

test('variants picks the matching case and merges it over siblings', () => {
  assert.deepEqual(renderMessage(variantTemplate, { status: 'ok' }).value, {
    card: {
      card_type: 'text_notice',
      main_title: { title: '共享标题' },
      source: { desc: '成功', desc_color: 3 },
    },
  });
  assert.deepEqual(renderMessage(variantTemplate, { status: 'bad' }).value, {
    card: {
      card_type: 'text_notice',
      main_title: { title: '覆盖标题' },
      source: { desc: '失败', desc_color: 2 },
    },
  });
});

test('variants falls back to default, then to the plain object', () => {
  const fallback = renderMessage(variantTemplate, { status: 'weird' });
  assert.deepEqual(fallback.value.card.source, { desc: '未知', desc_color: 1 });
  assert.deepEqual(fallback.warnings, []);

  const bare = renderMessage(
    { card: { title: 'x', variants: { by: 'status', cases: { ok: { title: 'y' } } } } },
    { status: 'nope' },
  );
  assert.deepEqual(bare.value, { card: { title: 'x' } });
  assert.equal(bare.warnings[0].code, 'W_VARIANT_UNMATCHED');
});

test('variants supports null to delete a sibling key', () => {
  const result = renderMessage(
    { card: { title: 'x', quote: 'keep', variants: { by: 'status', cases: { ok: { quote: null } } } } },
    { status: 'ok' },
  );
  assert.deepEqual(result.value, { card: { title: 'x' } });
});

test('variants validates its shape', () => {
  assert.throws(() => renderMessage({ a: { variants: 'nope' } }, {}), /must be a mapping/u);
  assert.throws(() => renderMessage({ a: { variants: { cases: {} } } }, {}), /requires "by"/u);
  assert.throws(() => renderMessage({ a: { variants: { by: 'x', cases: [], default: {} } } }, {}), /must be a mapping/u);
  assert.throws(() => renderMessage({ a: { variants: { by: 'x', cases: {}, extra: 1 } } }, {}), /Unknown "variants" key/u);
  assert.throws(
    () => renderMessage({ a: { variants: { by: 'x', cases: { y: 'not-an-object' } } } }, { x: 'y' }),
    /not a mapping/u,
  );
});

test('variants works inside array elements', () => {
  const result = renderMessage(
    {
      rows: [
        { variants: { by: 'count', cases: { 2: { text: 'two' } }, default: { text: 'other' } } },
        { variants: { by: 'count', cases: { 3: { text: 'three' } }, default: { text: 'other' } } },
      ],
    },
    context,
  );
  assert.deepEqual(result.value, { rows: [{ text: 'two' }, { text: 'other' }] });
});
