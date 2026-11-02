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
