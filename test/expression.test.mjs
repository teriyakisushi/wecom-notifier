import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluate,
  evaluateCondition,
  renderTemplateString,
  SUPPORTED_FILTERS,
} from '../src/template/expression.mjs';

const context = {
  repo: { name: 'demo', full_name: 'owner/demo', private: false },
  commits: [
    { short_sha: 'aaa111', first_line: 'feat: one' },
    { short_sha: 'bbb222', first_line: 'fix: two' },
  ],
  count: 2,
  text: 'hello world',
};

test('resolves paths, indexes, and typed values', () => {
  assert.equal(renderTemplateString('{{ repo.full_name }}', context), 'owner/demo');
  assert.equal(renderTemplateString('{{ commits[0].short_sha }}', context), 'aaa111');
  assert.equal(renderTemplateString('{{ count }}', context), 2);
  assert.equal(renderTemplateString('{{ repo.private }}', context), false);
  assert.equal(renderTemplateString('build-{{ count }}', context), 'build-2');
});

test('renders multiple placeholders in one string', () => {
  assert.equal(
    renderTemplateString('{{ commits[0].short_sha }} · {{ commits[0].first_line }}', context),
    'aaa111 · feat: one',
  );
  assert.equal(
    renderTemplateString('a {{ count }} b {{ text | upper }}', context),
    'a 2 b HELLO WORLD',
  );
});

test('supports comparisons, boolean operators, and grouping', () => {
  assert.equal(evaluateCondition('repo.name == "demo"', context), true);
  assert.equal(evaluateCondition('count > 1 && !repo.private', context), true);
  assert.equal(evaluateCondition('count < 1 || repo.private', context), false);
  assert.equal(evaluateCondition('(count == 2)', context), true);
  assert.throws(() => evaluate('count + 1', context), /Unexpected token/);
});

test('supports filters with both call syntaxes', () => {
  assert.equal(renderTemplateString('{{ text | upper }}', context), 'HELLO WORLD');
  assert.equal(renderTemplateString('{{ text | truncate: 5 }}', context), 'hell…');
  assert.equal(renderTemplateString('{{ commits | length }}', context), 2);
  assert.equal(renderTemplateString('{{ missing | default: "fallback" }}', context), 'fallback');
  assert.equal(renderTemplateString('{{ text | replace: "world", "there" }}', context), 'hello there');
  assert.equal(renderTemplateString('{{ "*bold*" | escapeMd }}', context), '\\*bold\\*');
  assert.equal(renderTemplateString('{{ "a b" | urlencode }}', context), 'a%20b');
});

test('escaped braces are preserved and the filter list is exported', () => {
  assert.equal(renderTemplateString('\\{{ repo.name }}', context), '{{ repo.name }}');
  assert.ok(SUPPORTED_FILTERS.includes('default'));
  assert.ok(SUPPORTED_FILTERS.includes('escapeMd'));
});

test('unknown paths render as undefined values', () => {
  assert.equal(renderTemplateString('{{ missing.value }}', context), undefined);
});
