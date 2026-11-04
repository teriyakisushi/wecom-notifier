import { ConfigError } from './errors.mjs';
import { isPlainObject, toBoolean, toInteger } from './util.mjs';

export const DEFAULTS = Object.freeze({
  webhook: '',
  preset: 'auto',
  payload: '',
  template: '',
  templateDir: '.github/wecom-notify',
  overrides: '',
  vars: '',
  title: '',
  subtitle: '',
  content: '',
  info: '',
  links: '',
  linkUrl: '',
  linkTitle: '查看详情',
  imageUrl: '',
  source: 'GitHub',
  sourceIcon: '',
  sourceColor: 0,
  dryRun: false,
  failOnError: true,
  autoTruncate: true,
  timeout: 10,
  retries: 2,
  apiBase: 'https://qyapi.weixin.qq.com',
  html: '',
  debug: false,
});

export const INPUT_KEYS = Object.freeze({
  webhook: 'webhook',
  preset: 'preset',
  payload: 'payload',
  template: 'template',
  templateDir: 'template-dir',
  overrides: 'overrides',
  vars: 'vars',
  title: 'title',
  subtitle: 'subtitle',
  content: 'content',
  info: 'info',
  links: 'links',
  linkUrl: 'link-url',
  linkTitle: 'link-title',
  imageUrl: 'image-url',
  source: 'source',
  sourceIcon: 'source-icon',
  sourceColor: 'source-color',
  dryRun: 'dry-run',
  failOnError: 'fail-on-error',
  autoTruncate: 'auto-truncate',
  timeout: 'timeout',
  retries: 'retries',
  apiBase: 'api-base',
  html: 'html',
  debug: 'debug',
});

const KEBAB_TO_CAMEL = Object.fromEntries(
  Object.entries(INPUT_KEYS).map(([camel, kebab]) => [kebab, camel]),
);

const BOOLEAN_KEYS = new Set(['dryRun', 'failOnError', 'autoTruncate', 'debug']);
const INTEGER_KEYS = new Set(['sourceColor', 'timeout', 'retries']);
const STRING_KEYS = new Set(Object.keys(INPUT_KEYS).filter((key) => !BOOLEAN_KEYS.has(key) && !INTEGER_KEYS.has(key)));

function normalizeKey(key) {
  if (Object.hasOwn(INPUT_KEYS, key)) return key;
  if (Object.hasOwn(KEBAB_TO_CAMEL, key)) return KEBAB_TO_CAMEL[key];
  const upper = String(key).toUpperCase().replaceAll('-', '_');
  for (const [camel, kebab] of Object.entries(INPUT_KEYS)) {
    if (kebab.toUpperCase().replaceAll('-', '_') === upper) return camel;
  }
  return null;
}

function normalizeObject(raw, sourceName) {
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${sourceName} must be a JSON object`, {
      code: 'E_INPUTS',
      hint: 'Pass a flat object whose keys are action input names, e.g. {"webhook":"...","preset":"auto"}.',
    });
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const normalized = normalizeKey(key);
    if (!normalized) continue;
    out[normalized] = value;
  }
  return out;
}

function envInputs(env) {
  const out = {};
  for (const [camel, kebab] of Object.entries(INPUT_KEYS)) {
    const envName = `INPUT_${kebab.toUpperCase().replaceAll('-', '_')}`;
    if (env[envName] !== undefined) out[camel] = env[envName];
  }
  return out;
}

function parseJsonInputs(env) {
  const raw = env.WECOM_INPUTS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (error) {
    throw new ConfigError('WECOM_INPUTS is not valid JSON', {
      code: 'E_INPUTS',
      hint: 'The action builds this value with toJSON(inputs); do not set it manually unless you are testing locally.',
      cause: error,
    });
  }
  return normalizeObject(parsed, 'WECOM_INPUTS');
}

/**
 * Merge action inputs from WECOM_INPUTS, INPUT_* env vars, and CLI overrides.
 * The order is: defaults < env INPUT_* < WECOM_INPUTS < CLI overrides.
 */
export function parseInputs({ env = process.env, cli = {} } = {}) {
  const fromEnv = envInputs(env);
  const fromJson = parseJsonInputs(env);
  const fromCli = normalizeObject(cli, 'CLI overrides');
  const merged = { ...fromEnv, ...fromJson, ...fromCli };
  const inputs = { ...DEFAULTS };

  for (const key of STRING_KEYS) {
    if (merged[key] !== undefined && merged[key] !== null) inputs[key] = String(merged[key]);
  }

  for (const key of BOOLEAN_KEYS) {
    if (merged[key] !== undefined) inputs[key] = toBoolean(merged[key], DEFAULTS[key]);
  }

  for (const key of INTEGER_KEYS) {
    if (merged[key] !== undefined && merged[key] !== '') {
      const value = toInteger(merged[key], Number.NaN);
      if (!Number.isInteger(value)) {
        throw new ConfigError(`Input "${INPUT_KEYS[key]}" must be an integer`, {
          code: 'E_INPUTS',
          path: INPUT_KEYS[key],
          hint: 'Use a whole number, for example 10.',
        });
      }
      inputs[key] = value;
    }
  }

  if (inputs.sourceColor < 0 || inputs.sourceColor > 3) {
    throw new ConfigError('Input "source-color" must be 0, 1, 2, or 3', {
      code: 'E_INPUTS',
      path: 'source-color',
      hint: '0 = gray, 1 = black, 2 = red, 3 = green.',
    });
  }
  if (inputs.timeout < 1 || inputs.timeout > 60) {
    throw new ConfigError('Input "timeout" must be between 1 and 60 seconds', {
      code: 'E_INPUTS',
      path: 'timeout',
    });
  }
  if (inputs.retries < 0 || inputs.retries > 5) {
    throw new ConfigError('Input "retries" must be between 0 and 5', {
      code: 'E_INPUTS',
      path: 'retries',
    });
  }

  inputs.webhook = inputs.webhook.trim();
  inputs.template = inputs.template.trim();
  inputs.templateDir = inputs.templateDir.trim();
  inputs.preset = inputs.preset.trim().toLowerCase() || 'auto';
  inputs.apiBase = inputs.apiBase.trim().replace(/\/+$/u, '') || DEFAULTS.apiBase;

  return inputs;
}

export function flatInputs(inputs) {
  return {
    title: inputs.title,
    subtitle: inputs.subtitle,
    content: inputs.content,
    info: inputs.info,
    links: inputs.links,
    linkUrl: inputs.linkUrl,
    linkTitle: inputs.linkTitle,
    imageUrl: inputs.imageUrl,
    source: inputs.source,
    sourceIcon: inputs.sourceIcon,
    sourceColor: inputs.sourceColor,
  };
}

export function getEventName({ env = process.env, cli = {} } = {}) {
  return String(cli.eventName ?? env.GITHUB_EVENT_NAME ?? 'unknown').trim() || 'unknown';
}
