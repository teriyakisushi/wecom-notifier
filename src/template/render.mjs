import { TemplateError } from '../errors.mjs';
import { isPlainObject } from '../util.mjs';
import { evaluate, evaluateCondition, renderTemplateString, stringifyScalar } from './expression.mjs';

const MAX_DEPTH = 20;
const MAX_NODES = 10000;
const MAX_ITERATIONS = 100;
const DIRECTIVES = new Set(['$if', '$each', '$item', '$limit', '$as', '$join', '$prefix', '$suffix']);
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

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

function renderObject(node, state, context, locals, path) {
  const keys = Object.keys(node);
  const hasEach = Object.hasOwn(node, '$each');
  const hasIf = Object.hasOwn(node, '$if');

  if (hasEach) {
    if (hasIf) {
      fail('$each and $if cannot be combined on the same object', path, 'Move $if inside $item, or use two nested objects.');
    }
    return renderEach(node, state, context, locals, path);
  }

  if (hasIf) {
    const condition = evaluateCondition(node.$if, context, locals);
    if (!condition) return undefined;
  }

  const out = {};
  for (const key of keys) {
    if (key.startsWith('$')) {
      if (key === '$if' && hasIf) continue;
      if (!DIRECTIVES.has(key)) {
        fail(`Unknown directive "${key}"`, `${path}.${key}`, 'Directives are $if, $each, $item, $limit, $as, $join, $prefix, $suffix.');
      }
      // A stray $each/$item/etc. is a configuration mistake.
      fail(`Directive "${key}" is not valid here`, `${path}.${key}`);
    }
    const value = renderValue(node[key], state, context, locals, `${path}.${key}`);
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
