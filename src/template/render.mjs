import { TemplateError } from '../errors.mjs';
import { deepMerge, isPlainObject } from '../util.mjs';
import { evaluate, evaluateCondition, renderTemplateString, stringifyScalar } from './expression.mjs';

const MAX_DEPTH = 20;
const MAX_NODES = 10000;
const MAX_ITERATIONS = 100;
const DIRECTIVES = new Set(['$if', '$each', '$item', '$limit', '$as', '$join', '$prefix', '$suffix']);
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

// Readable aliases: `when`/`for` mirror `$if`/`$each`. Templates may mix them,
// but a single object cannot use both spellings of the same directive.
const ALIASES = Object.freeze({
  when: '$if',
  for: '$each',
  item: '$item',
  as: '$as',
  limit: '$limit',
  join: '$join',
  prefix: '$prefix',
  suffix: '$suffix',
});
const FOR_KEYS = new Set(['for', 'item', 'as', 'limit', 'join', 'prefix', 'suffix']);
const VARIANT_KEYS = new Set(['by', 'key', 'cases', 'default']);
const DIRECTIVE_HINT =
  'Directives are $if (alias when), $each (alias for), $item, $limit, $as, $join, $prefix, $suffix.';

function fail(message, path, hint) {
  throw new TemplateError(message, { code: 'E_TEMPLATE_RENDER', path, hint });
}

function createState() {
  return {
    depth: 0,
    nodes: 0,
    warnings: [],
  };
}

function tick(state, path) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) {
    fail(`Template expanded to more than ${MAX_NODES} nodes`, path, 'Check for recursive or unexpectedly large $each loops.');
  }
}

function evaluateDirective(value, context, locals, path) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') {
    fail('Directive must be an expression string', path, 'Use a string such as "$each: commits" or a literal value.');
  }
  const text = value.trim();
  if (!text) return undefined;
  const unwrapped = /^\{\{([\s\S]*)\}\}$/u.exec(text);
  return evaluate(unwrapped ? unwrapped[1] : text, context, locals);
}

function renderEach(node, state, context, locals, path) {
  const allowed = new Set(['$each', '$item', '$limit', '$as', '$join', '$prefix', '$suffix']);
  for (const key of Object.keys(node)) {
    if (key.startsWith('$') && !allowed.has(key)) {
      fail(`Directive "${key}" is not allowed together with $each`, `${path}.${key}`, 'Use $if on a parent object or inside $item.');
    }
  }
  if (!Object.hasOwn(node, '$item')) {
    fail('$each requires a sibling $item template', path, 'Add $item with the template for each element.');
  }

  const source = evaluateDirective(node.$each, context, locals, `${path}.$each`);
  let items;
  if (source === undefined || source === null) items = [];
  else if (Array.isArray(source)) items = source;
  else {
    fail(`$each expected an array, got ${typeof source}`, `${path}.$each`, 'Use a path that points to a list, such as commits.');
  }

  let limit = MAX_ITERATIONS;
  if (Object.hasOwn(node, '$limit')) {
    const raw = evaluateDirective(node.$limit, context, locals, `${path}.$limit`);
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 1) {
      fail('$limit must be a positive integer', `${path}.$limit`);
    }
    limit = Math.min(num, MAX_ITERATIONS);
  }
  if (items.length > limit) {
    state.warnings.push({
      code: 'W_EACH_LIMIT',
      path: `${path}.$each`,
      message: `$each produced ${items.length} items; only the first ${limit} are used (hard limit ${MAX_ITERATIONS}).`,
    });
    items = items.slice(0, limit);
  }

  let alias = 'item';
  if (Object.hasOwn(node, '$as')) {
    const raw = node.$as;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!IDENTIFIER_RE.test(name)) {
      fail('$as must be a valid identifier', `${path}.$as`, 'For example: $as: commit');
    }
    alias = name;
  }

  const hasJoin = Object.hasOwn(node, '$join');
  const hasPrefix = Object.hasOwn(node, '$prefix');
  const hasSuffix = Object.hasOwn(node, '$suffix');
  if (!hasJoin && (hasPrefix || hasSuffix)) {
    fail('$prefix/$suffix require $join', path, 'Use $join to create a string, or remove $prefix/$suffix.');
  }

  const rendered = [];
  for (const item of items) {
    const itemLocals = { ...locals, [alias]: item };
    const value = renderValue(node.$item, state, context, itemLocals, `${path}.$item`);
    if (value === undefined) continue;
    rendered.push(value);
  }

  if (!hasJoin) return rendered;

  const separator = stringifyScalar(
    renderValue(node.$join, state, context, locals, `${path}.$join`),
  );
  const prefix = hasPrefix
    ? stringifyScalar(renderValue(node.$prefix, state, context, locals, `${path}.$prefix`))
    : '';
  const suffix = hasSuffix
    ? stringifyScalar(renderValue(node.$suffix, state, context, locals, `${path}.$suffix`))
    : '';
  const body = rendered.map((item) => stringifyScalar(item)).join(separator);
  return `${prefix}${body}${suffix}`;
}

function withoutVariants(node) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'variants') continue;
    out[key] = value;
  }
  return out;
}

/**
 * `variants` picks one branch and merges it into the surrounding object, so a
 * template can share common fields and override only what changes per outcome:
 *
 *   template_card:
 *     card_type: news_notice
 *     variants:
 *       by: workflow_run.conclusion
 *       cases:
 *         success: { source: {...} }
 *         failure: { source: {...} }
 *       default: { source: {...} }
 *
 * The matched branch wins over sibling keys; `null` inside a branch deletes a
 * sibling key. An unmatched selector falls through to `default`.
 */
function resolveVariants(node, state, context, locals, path) {
  const spec = node.variants;
  const specPath = `${path}.variants`;
  if (!isPlainObject(spec)) {
    fail('"variants" must be a mapping', specPath, 'Use variants: {by: <path>, cases: {<value>: {...}}, default: {...}}.');
  }
  for (const key of Object.keys(spec)) {
    if (!VARIANT_KEYS.has(key)) {
      fail(`Unknown "variants" key "${key}"`, `${specPath}.${key}`, 'Allowed keys are by, cases, and default.');
    }
  }
  const selector = spec.by ?? spec.key;
  if (selector === undefined || selector === null || selector === '') {
    fail('"variants" requires "by"', specPath, 'Point it at a context path, such as workflow_run.conclusion.');
  }

  const cases = spec.cases ?? {};
  if (!isPlainObject(cases)) {
    fail('"variants.cases" must be a mapping', `${specPath}.cases`, 'Each key is a possible selector value.');
  }

  const raw = evaluateDirective(selector, context, locals, `${specPath}.by`);
  const key = raw === undefined || raw === null ? '' : stringifyScalar(raw);
  const matched = Object.hasOwn(cases, key);
  const chosen = matched ? cases[key] : spec.default;

  if (chosen === undefined || chosen === null) {
    if (!matched && !Object.hasOwn(spec, 'default')) {
      state.warnings.push({
        code: 'W_VARIANT_UNMATCHED',
        path: specPath,
        message: `variants had no case for "${key}" and no default; the object was left without that branch.`,
      });
    }
    return withoutVariants(node);
  }
  if (!isPlainObject(chosen)) {
    fail(
      `"variants" selected a branch for "${key}" that is not a mapping`,
      matched ? `${specPath}.cases.${key}` : `${specPath}.default`,
    );
  }
  return deepMerge(withoutVariants(node), chosen, specPath);
}

/**
 * Translate the readable aliases into the canonical `$`-prefixed directives.
 * `when`/`for` are pure sugar: the rest of the renderer only sees `$if`/`$each`.
 */
function normalizeDirectives(node, path) {
  const hasFor = Object.hasOwn(node, 'for');
  const hasWhen = Object.hasOwn(node, 'when');
  if (!hasFor && !hasWhen) return node;
  if (hasFor && Object.hasOwn(node, '$each')) {
    fail('Use either "for" or "$each", not both', path, 'They are the same directive; keep the readable "for" form.');
  }
  if (hasWhen && Object.hasOwn(node, '$if')) {
    fail('Use either "when" or "$if", not both', path, 'They are the same directive; keep the readable "when" form.');
  }

  if (hasFor) {
    const out = { $each: node.for };
    for (const [key, value] of Object.entries(node)) {
      if (key === 'for') continue;
      if (!FOR_KEYS.has(key)) {
        fail(
          `"${key}" cannot sit next to "for"`,
          `${path}.${key}`,
          'A "for" block only accepts for, item, as, limit, join, prefix, and suffix. Move other fields inside item.',
        );
      }
      out[ALIASES[key]] = value;
    }
    if (!Object.hasOwn(out, '$item')) {
      fail('"for" requires an "item" template', path, 'Add item: { ... } describing one element.');
    }
    return out;
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'when') out.$if = value;
    else out[key] = value;
  }
  return out;
}

function renderObject(node, state, context, locals, path) {
  let current = node;
  if (Object.hasOwn(current, 'variants')) {
    current = resolveVariants(current, state, context, locals, path);
  }
  current = normalizeDirectives(current, path);

  const keys = Object.keys(current);
  const hasEach = Object.hasOwn(current, '$each');
  const hasIf = Object.hasOwn(current, '$if');

  if (hasEach) {
    if (hasIf) {
      fail(
        'for/$each and when/$if cannot be combined on the same object',
        path,
        'Move the condition inside item, or nest the object one level deeper.',
      );
    }
    return renderEach(current, state, context, locals, path);
  }

  if (hasIf) {
    const condition = evaluateCondition(current.$if, context, locals);
    if (!condition) return undefined;
  }

  const out = {};
  for (const key of keys) {
    if (key.startsWith('$')) {
      if (key === '$if' && hasIf) continue;
      if (!DIRECTIVES.has(key)) {
        fail(`Unknown directive "${key}"`, `${path}.${key}`, DIRECTIVE_HINT);
      }
      // A stray $each/$item/etc. is a configuration mistake.
      fail(`Directive "${key}" is not valid here`, `${path}.${key}`);
    }
    const value = renderValue(current[key], state, context, locals, `${path}.${key}`);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function renderArray(node, state, context, locals, path) {
  const out = [];
  for (let index = 0; index < node.length; index += 1) {
    const value = renderValue(node[index], state, context, locals, `${path}[${index}]`);
    if (value === undefined) continue;
    out.push(value);
  }
  return out;
}

function renderValue(value, state, context, locals, path) {
  tick(state, path);
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    try {
      return renderTemplateString(value, context, locals);
    } catch (error) {
      if (error instanceof TemplateError) {
        throw new TemplateError(error.message, {
          code: error.code,
          path,
          hint: error.hint,
          cause: error,
        });
      }
      throw error;
    }
  }

  if (Array.isArray(value)) {
    state.depth += 1;
    if (state.depth > MAX_DEPTH) fail(`Template nesting exceeds ${MAX_DEPTH}`, path);
    try {
      return renderArray(value, state, context, locals, path);
    } finally {
      state.depth -= 1;
    }
  }

  if (isPlainObject(value)) {
    state.depth += 1;
    if (state.depth > MAX_DEPTH) fail(`Template nesting exceeds ${MAX_DEPTH}`, path);
    try {
      return renderObject(value, state, context, locals, path);
    } finally {
      state.depth -= 1;
    }
  }

  return value;
}

/**
 * Render a message/config tree with the template context.
 * Returns `{ value, warnings }`; warnings are non-fatal limits/observations.
 *
 * @param {unknown} message
 * @param {object} context
 * @param {{locals?: object}} [options]
 */
export function renderMessage(message, context, options = {}) {
  const state = createState();
  const locals = options.locals ?? {};
  const value = renderValue(message, state, context, locals, '$');
  return { value, warnings: state.warnings };
}

export function renderString(value, context, locals = {}) {
  return renderTemplateString(value, context, locals);
}

export { evaluateDirective };
