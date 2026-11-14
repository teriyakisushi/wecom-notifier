import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULTS, INPUT_KEYS } from '../src/inputs.mjs';

const actionYml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

/** 取出 action.yml 的 inputs: 段，避免把 outputs: 里的键也算进来。 */
function declaredInputs(text) {
  const start = text.indexOf('\ninputs:\n');
  const end = text.indexOf('\noutputs:\n');
  assert.ok(start !== -1 && end > start, 'action.yml must have inputs: and outputs: sections');
  const block = text.slice(start + 1, end);
  return [...block.matchAll(/^  ([a-z0-9-]+):$/gm)].map((m) => m[1]).sort();
}

test('every src/inputs.mjs input is declared in action.yml', () => {
  // Composite Action 通过 toJSON(inputs) 传参，未声明的 input 根本到不了代码，
  // 所以这里必须双向对齐，漏一个就等于文档里的能力静默失效。
  const declared = declaredInputs(actionYml);
  const implemented = Object.values(INPUT_KEYS).sort();
  assert.deepEqual(declared, implemented);
});

test('INPUT_KEYS and DEFAULTS describe the same input set', () => {
  assert.deepEqual(Object.keys(INPUT_KEYS).sort(), Object.keys(DEFAULTS).sort());
});

test('input names are kebab-case and unique', () => {
  const names = Object.values(INPUT_KEYS);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  }
});
