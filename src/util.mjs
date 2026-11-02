import { ConfigError } from './errors.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep clone plain JSON-like values. Functions and symbols are not supported
 * (templates are YAML/JSON only), so this stays small and predictable.
 */
export function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clone(item);
    return out;
  }
  return value;
}

function assertSafeKey(key, path) {
  if (UNSAFE_KEYS.has(key)) {
    throw new ConfigError(`Unsafe object key "${key}" is not allowed`, {
      path,
      hint: 'Remove __proto__, constructor, or prototype keys from YAML/JSON.',
    });
  }
}

/**
 * Merge a patch into a base value.
 *
 * - plain objects are merged recursively
 * - arrays are replaced
 * - `null` deletes the key
 * - 0 and false are kept
 * - the base value is never mutated
 */
export function deepMerge(base, patch, path = '') {
  if (patch === null) return undefined;
  if (!isPlainObject(patch)) return clone(patch);
  const out = isPlainObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    const childPath = path ? `${path}.${key}` : key;
    assertSafeKey(key, childPath);
    if (value === null) {
      delete out[key];
      continue;
    }
    if (isPlainObject(value)) {
      out[key] = deepMerge(out[key], value, childPath);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function isEmptyValue(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * Recursively remove empty values: undefined, null, '', [], and {}.
 * Numbers (including 0) and booleans (including false) are preserved.
 */
export function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const pruned = pruneEmpty(item);
      if (pruned === undefined || isEmptyValue(pruned)) continue;
      out.push(pruned);
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const pruned = pruneEmpty(item);
      if (pruned === undefined || isEmptyValue(pruned)) continue;
      out[key] = pruned;
    }
    return out;
  }
  return value;
}

export function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

export function codePointLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function fitChars(value, max, suffix = '…') {
  const text = String(value ?? '');
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 0) return '';
  const suffixChars = Array.from(suffix);
  if (suffixChars.length >= max) return suffixChars.slice(0, max).join('');
  return chars.slice(0, max - suffixChars.length).join('') + suffix;
}

export function fitBytes(value, max, suffix = '…') {
  const text = String(value ?? '');
  if (byteLength(text) <= max) return text;
  if (max <= 0) return '';
  const suffixBytes = byteLength(suffix);
  if (suffixBytes >= max) {
    // Fit the suffix itself, cutting at code point boundaries.
    let out = '';
    for (const ch of suffix) {
      if (byteLength(out + ch) > max) break;
      out += ch;
    }
    return out;
  }
  const budget = max - suffixBytes;
  let out = '';
  for (const ch of text) {
    if (byteLength(out + ch) > budget) break;
    out += ch;
  }
  return out + suffix;
}

export function oneLine(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

export function shortSha(value) {
  return String(value ?? '').slice(0, 7);
}

export function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

export function toInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isInteger(num)) return fallback;
  return num;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function firstLine(value) {
  return String(value ?? '').split(/\r?\n/u)[0].trim();
}

export function unique(values) {
  return [...new Set(values)];
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/u.test(value)) return false;
  return !value.split(/[\\/]+/u).includes('..');
}
