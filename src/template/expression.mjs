import { TemplateError } from '../errors.mjs';
import { byteLength, codePointLength, fitBytes, fitChars } from '../util.mjs';

/**
 * A deliberately small expression language for `{{ ... }}` and `$if`.
 *
 * Supported:
 *   paths:       repo.full_name, commits[0].short_sha, vars.env
 *   literals:    "text", 42, true, false, null
 *   comparisons: == != > >= < <=
 *   logic:       ! && ||
 *   grouping:    ( ... )
 *   filters:     value | truncate(80) | default("-")
 *
 * There are no function calls, arithmetic, assignments, or object literals.
 */

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FILTERS = {
  default(value, args) {
    const fallback = args[0];
    if (value === undefined || value === null || value === '') return fallback ?? '';
    return value;
  },
  truncate(value, args) {
    const max = toPositiveInt(args[0], 80);
    return fitChars(stringifyScalar(value), max);
  },
  truncateBytes(value, args) {
    const max = toPositiveInt(args[0], 300);
    return fitBytes(stringifyScalar(value), max);
  },
  firstLine(value) {
    return stringifyScalar(value).split(/\r?\n/u)[0].trim();
  },
  oneLine(value) {
    return stringifyScalar(value).replace(/\s+/gu, ' ').trim();
  },
  upper(value) {
    return stringifyScalar(value).toUpperCase();
  },
  lower(value) {
    return stringifyScalar(value).toLowerCase();
  },
  replace(value, args) {
    const from = stringifyScalar(args[0] ?? '');
    const to = stringifyScalar(args[1] ?? '');
    if (!from) return stringifyScalar(value);
    return stringifyScalar(value).split(from).join(to);
  },
  join(value, args) {
    const sep = args[0] === undefined ? ', ' : stringifyScalar(args[0]);
    if (Array.isArray(value)) return value.map((item) => stringifyScalar(item)).join(sep);
    return stringifyScalar(value);
  },
  take(value, args) {
    const count = toNonNegativeInt(args[0], 10);
    if (Array.isArray(value)) return value.slice(0, count);
    return Array.from(stringifyScalar(value)).slice(0, count).join('');
  },
  skip(value, args) {
    const count = toNonNegativeInt(args[0], 0);
    if (Array.isArray(value)) return value.slice(count);
    return Array.from(stringifyScalar(value)).slice(count).join('');
  },
  first(value) {
    if (Array.isArray(value)) return value[0];
    return Array.from(stringifyScalar(value))[0] ?? '';
  },
  last(value) {
    if (Array.isArray(value)) return value[value.length - 1];
    const chars = Array.from(stringifyScalar(value));
    return chars[chars.length - 1] ?? '';
  },
  length(value) {
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'string') return codePointLength(value);
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
  },
  json(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return stringifyScalar(value);
    }
  },
  urlencode(value) {
    return encodeURIComponent(stringifyScalar(value));
  },
  escapeMd(value) {
    return stringifyScalar(value).replace(/[\\`*_{}[\]()#+\-.!|>~]/gu, '\\$&');
  },
};

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function toNonNegativeInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

export function stringifyScalar(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function isTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      i += 1;
      let closed = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\') {
          const next = source[i + 1];
          if (next === undefined) break;
          if (next === 'n') value += '\n';
          else if (next === 'r') value += '\r';
          else if (next === 't') value += '\t';
          else if (next === 'b') value += '\b';
          else if (next === 'f') value += '\f';
          else if (next === 'u') {
            const hex = source.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/u.test(hex)) throw syntaxError('Invalid unicode escape', i);
            value += String.fromCharCode(Number.parseInt(hex, 16));
            i += 4;
          } else if (next === '\\' || next === quote) value += next;
          else value += next;
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          closed = true;
          break;
        }
        value += c;
        i += 1;
      }
      if (!closed) throw syntaxError('Unterminated string literal', i);
      tokens.push({ type: 'string', value, pos: i - value.length - 2 });
      continue;
    }
    if (/\d/u.test(ch) || (ch === '.' && /\d/u.test(source[i + 1] ?? ''))) {
      const start = i;
      while (i < n && /\d/u.test(source[i])) i += 1;
      if (source[i] === '.') {
        i += 1;
        while (i < n && /\d/u.test(source[i])) i += 1;
      }
      const raw = source.slice(start, i);
      tokens.push({ type: 'number', value: Number(raw), pos: start });
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch)) {
      const start = i;
      i += 1;
      while (i < n && /[A-Za-z0-9_$]/u.test(source[i])) i += 1;
      const value = source.slice(start, i);
      tokens.push({ type: 'identifier', value, pos: start });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two, pos: i });
      i += 2;
      continue;
    }
    if ('!><|.\[\](),:+-'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch, pos: i });
      i += 1;
      continue;
    }
    throw syntaxError(`Unexpected character "${ch}"`, i);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

function syntaxError(message, pos) {
  return new TemplateError(`${message} at column ${pos + 1}`, {
    code: 'E_TEMPLATE_EXPR',
    hint: 'Check the expression syntax; only paths, literals, comparisons, logic, and filters are supported.',
  });
}

class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  next() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  matchOperator(value) {
    const token = this.peek();
    if (token.type === 'operator' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  expectOperator(value) {
    const token = this.next();
    if (token.type !== 'operator' || token.value !== value) {
      throw syntaxError(`Expected "${value}"`, token.pos);
    }
  }

  parse() {
    const expression = this.parseFiltered();
    if (this.peek().type !== 'eof') {
      throw syntaxError(`Unexpected token "${this.peek().value}"`, this.peek().pos);
    }
    return expression;
  }

  parseFiltered() {
    let expression = this.parseOr();
    while (this.matchOperator('|')) {
      const nameToken = this.next();
      if (nameToken.type !== 'identifier') {
        throw syntaxError('Expected a filter name after "|"', nameToken.pos);
      }
      const name = nameToken.value;
      if (!Object.hasOwn(FILTERS, name)) {
        throw new TemplateError(`Unknown filter "${name}"`, {
          code: 'E_TEMPLATE_FILTER',
          hint: `Available filters: ${Object.keys(FILTERS).join(', ')}`,
        });
      }
      const args = [];
      if (this.matchOperator('(')) {
        if (!this.matchOperator(')')) {
          args.push(this.parseOr());
          while (this.matchOperator(',')) args.push(this.parseOr());
          this.expectOperator(')');
        }
      } else if (this.matchOperator(':')) {
        args.push(this.parseOr());
        while (this.matchOperator(',')) args.push(this.parseOr());
      }
      expression = { type: 'filter', name, value: expression, args };
    }
    return expression;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      left = { type: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseEquality();
    while (this.matchOperator('&&')) {
      left = { type: 'binary', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (true) {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '==' || token.value === '!=')) {
        this.next();
        left = { type: 'binary', op: token.value, left, right: this.parseComparison() };
      } else {
        break;
      }
    }
    return left;
  }

  parseComparison() {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (token.type === 'operator' && ['>', '>=', '<', '<='].includes(token.value)) {
        this.next();
        left = { type: 'binary', op: token.value, left, right: this.parseUnary() };
      } else {
        break;
      }
    }
    return left;
  }

  parseUnary() {
    if (this.matchOperator('!')) return { type: 'unary', op: '!', arg: this.parseUnary() };
    if (this.matchOperator('-')) return { type: 'unary', op: '-', arg: this.parseUnary() };
    if (this.matchOperator('+')) return { type: 'unary', op: '+', arg: this.parseUnary() };
    return this.parsePostfix();
  }

  parsePostfix() {
    let expression = this.parsePrimary();
    while (true) {
      if (this.matchOperator('.')) {
        const nameToken = this.next();
        if (nameToken.type !== 'identifier') {
          throw syntaxError('Expected a property name after "."', nameToken.pos);
        }
        expression = { type: 'member', object: expression, property: { type: 'literal', value: nameToken.value } };
      } else if (this.matchOperator('[')) {
        const property = this.parseOr();
        this.expectOperator(']');
        expression = { type: 'member', object: expression, property };
      } else {
        break;
      }
    }
    return expression;
  }

  parsePrimary() {
    const token = this.next();
    if (token.type === 'number' || token.type === 'string') {
      return { type: 'literal', value: token.value };
    }
    if (token.type === 'identifier') {
      if (token.value === 'true') return { type: 'literal', value: true };
      if (token.value === 'false') return { type: 'literal', value: false };
      if (token.value === 'null') return { type: 'literal', value: null };
      if (token.value === 'undefined') return { type: 'literal', value: undefined };
      return { type: 'path', name: token.value };
    }
    if (token.type === 'operator' && token.value === '(') {
      const expression = this.parseFiltered();
      this.expectOperator(')');
      return expression;
    }
    throw syntaxError(`Unexpected token "${token.value || token.type}"`, token.pos);
  }
}

function getMember(object, property) {
  if (object === undefined || object === null) return undefined;
  const key = String(property);
  if (UNSAFE_KEYS.has(key)) return undefined;
  try {
    return object[key];
  } catch {
    return undefined;
  }
}

function resolvePath(name, context, locals) {
  if (Object.hasOwn(locals, name)) return locals[name];
  if (context && typeof context === 'object' && Object.hasOwn(context, name)) return context[name];
  return undefined;
}

function evaluateAst(node, context, locals) {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'path':
      return resolvePath(node.name, context, locals);
    case 'member':
      return getMember(evaluateAst(node.object, context, locals), evaluateAst(node.property, context, locals));
    case 'unary': {
      const value = evaluateAst(node.arg, context, locals);
      if (node.op === '!') return !isTruthy(value);
      if (node.op === '-') return -Number(value);
      if (node.op === '+') return Number(value);
      return false;
    }
    case 'binary': {
      if (node.op === '&&') {
        const left = evaluateAst(node.left, context, locals);
        return isTruthy(left) ? evaluateAst(node.right, context, locals) : left;
      }
      if (node.op === '||') {
        const left = evaluateAst(node.left, context, locals);
        return isTruthy(left) ? left : evaluateAst(node.right, context, locals);
      }
      const left = evaluateAst(node.left, context, locals);
      const right = evaluateAst(node.right, context, locals);
      switch (node.op) {
        case '==':
          if (left === null || left === undefined || right === null || right === undefined) {
            return (left === null || left === undefined) && (right === null || right === undefined);
          }
          return left === right;
        case '!=': {
          if (left === null || left === undefined || right === null || right === undefined) {
            return !((left === null || left === undefined) && (right === null || right === undefined));
          }
          return left !== right;
        }
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        default:
          return false;
      }
    }
    case 'filter': {
      const value = evaluateAst(node.value, context, locals);
      const args = node.args.map((arg) => evaluateAst(arg, context, locals));
      return FILTERS[node.name](value, args);
    }
    default:
      return undefined;
  }
}

const cache = new Map();

export function parseExpression(source) {
  const text = String(source ?? '').trim();
  if (!text) throw new TemplateError('Empty expression', { code: 'E_TEMPLATE_EXPR' });
  if (!cache.has(text)) cache.set(text, new Parser(text).parse());
  return cache.get(text);
}

/**
 * Evaluate an expression against the template context.
 * @param {string} source
 * @param {object} context
 * @param {object} [locals]
 */
export function evaluate(source, context, locals = {}) {
  const ast = parseExpression(source);
  return evaluateAst(ast, context, locals);
}

/**
 * Render a string with `{{ ... }}` placeholders.
 *
 * If the whole string is one expression, the typed value is returned (so an
 * `$each` can iterate over an array). Otherwise placeholders are stringified.
 */
export function renderTemplateString(input, context, locals = {}) {
  const text = String(input ?? '');
  const escapedOpen = '\u0000OPEN\u0000';
  const escapedClose = '\u0000CLOSE\u0000';
  const protectedText = text.replace(/\\\{\{/gu, escapedOpen).replace(/\\\}\}/gu, escapedClose);

  const full = /^\s*\{\{((?:(?!\}\})[\s\S])*)\}\}\s*$/u.exec(protectedText);
  if (full) {
    const value = evaluate(full[1], context, locals);
    return value;
  }

  const rendered = protectedText.replace(/\{\{([\s\S]*?)\}\}/gu, (_match, expression) => {
    const value = evaluate(expression, context, locals);
    return stringifyScalar(value);
  });
  return rendered.replaceAll(escapedOpen, '{{').replaceAll(escapedClose, '}}');
}

export function evaluateCondition(input, context, locals = {}) {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  if (input === null || input === undefined) return false;
  const text = String(input).trim();
  if (!text) return false;
  const unwrapped = /^\{\{((?:(?!\}\})[\s\S])*)\}\}$/u.exec(text);
  const expression = unwrapped ? unwrapped[1] : text;
  return isTruthy(evaluate(expression, context, locals));
}

export const SUPPORTED_FILTERS = Object.keys(FILTERS);

export function describeValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return 'object';
  return `${typeof value}`;
}

export function byteLengthOf(value) {
  return byteLength(stringifyScalar(value));
}
