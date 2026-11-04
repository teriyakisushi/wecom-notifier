import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { ConfigError } from './errors.mjs';
import { isPlainObject, isSafeRelativePath } from './util.mjs';

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
const TEMPLATE_EXTENSIONS = ['.yml', '.yaml'];
const DEFAULT_NAMES = ['default.yml', 'default.yaml', '_default.yml', '_default.yaml'];

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function yamlError(error, sourcePath) {
  const position = Array.isArray(error.linePos) && error.linePos[0] ? ` at line ${error.linePos[0].line}, column ${error.linePos[0].col}` : '';
  return new ConfigError(`Invalid YAML${position}: ${error.message}`, {
    code: 'E_YAML',
    path: sourcePath,
    hint: 'Fix the YAML syntax. JSON is also valid YAML.',
    cause: error,
  });
}

/**
 * Parse YAML or JSON. YAML 1.2 is a JSON superset, so a single parser is enough.
 * @returns {unknown}
 */
export function parseYamlOrJson(text, sourcePath = '<inline>') {
  const source = stripBom(String(text ?? ''));
  let document;
  try {
    document = parseDocument(source, {
      prettyErrors: true,
      uniqueKeys: true,
      maxAliasCount: 100,
    });
  } catch (error) {
    throw yamlError(error, sourcePath);
  }
  if (document.errors.length > 0) throw yamlError(document.errors[0], sourcePath);
  try {
    return document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new ConfigError(`Could not convert YAML to an object: ${error.message}`, {
      code: 'E_YAML',
      path: sourcePath,
      cause: error,
    });
  }
}

/**
 * Resolve a user path inside the checkout. Rejects absolute paths outside the
 * workspace, `..` traversal, and symlinks that escape the workspace.
 */
export function resolveWorkspacePath(workspace, inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new ConfigError('Path must not be empty', { code: 'E_PATH', path: 'template' });
  }
  if (!isSafeRelativePath(inputPath)) {
    throw new ConfigError(`Path escapes the workspace: ${inputPath}`, {
      code: 'E_PATH',
      path: 'template',
      hint: 'Use a repository-relative path such as .github/wecom-notify/push.yml.',
    });
  }
  const root = path.resolve(workspace);
  const target = path.resolve(root, inputPath);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError(`Path escapes the workspace: ${inputPath}`, {
      code: 'E_PATH',
      path: 'template',
      hint: 'Use a repository-relative path such as .github/wecom-notify/push.yml.',
    });
  }
  if (existsSync(target)) {
    let real;
    try {
      real = realpathSync(target);
    } catch (error) {
      throw new ConfigError(`Could not resolve path: ${inputPath}`, {
        code: 'E_PATH',
        path: 'template',
        cause: error,
      });
    }
    const realRelative = path.relative(root, real);
    if (realRelative === '' || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new ConfigError(`Path resolves outside the workspace: ${inputPath}`, {
        code: 'E_PATH',
        path: 'template',
        hint: 'Symlinks must stay inside the repository checkout.',
      });
    }
  }
  return target;
}

function readTemplateFile(filePath, sourceLabel) {
  let stat;
  try {
    stat = statSync(filePath);
  } catch (error) {
    throw new ConfigError(`Template file not found: ${sourceLabel}`, {
      code: 'E_TEMPLATE_NOT_FOUND',
      path: sourceLabel,
      hint: 'Commit the template file, or run actions/checkout before this action.',
      cause: error,
    });
  }
  if (!stat.isFile()) {
    throw new ConfigError(`Template path is not a file: ${sourceLabel}`, {
      code: 'E_TEMPLATE_NOT_FILE',
      path: sourceLabel,
    });
  }
  if (stat.size > MAX_TEMPLATE_BYTES) {
    throw new ConfigError(`Template file is larger than ${MAX_TEMPLATE_BYTES} bytes: ${sourceLabel}`, {
      code: 'E_TEMPLATE_TOO_LARGE',
      path: sourceLabel,
    });
  }
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read template file: ${sourceLabel}`, {
      code: 'E_TEMPLATE_READ',
      path: sourceLabel,
      cause: error,
    });
  }
}

function normalizeDocument(value, sourcePath) {
  if (!isPlainObject(value)) {
    throw new ConfigError('Template must be a YAML/JSON object', {
      code: 'E_TEMPLATE_SHAPE',
      path: sourcePath,
      hint: 'The top level should be a WeCom message object or a config wrapper with extends/overrides.',
    });
  }
  if (Object.keys(value).length === 0) {
    throw new ConfigError('Template is empty', { code: 'E_TEMPLATE_SHAPE', path: sourcePath });
  }

  if (Object.hasOwn(value, 'msgtype')) {
    const reserved = ['extends', 'vars', 'overrides'].filter((key) => Object.hasOwn(value, key));
    if (reserved.length > 0) {
      throw new ConfigError(
        `A message template cannot also contain ${reserved.map((key) => `"${key}"`).join(', ')}`,
        { code: 'E_TEMPLATE_SHAPE', path: sourcePath },
      );
    }
    return {
      kind: 'message',
      message: value,
      extends: null,
      vars: {},
      overrides: {},
    };
  }

  const allowed = new Set(['extends', 'vars', 'overrides']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ConfigError(`Unknown config key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, {
      code: 'E_TEMPLATE_SHAPE',
      path: sourcePath,
      hint: 'A config wrapper may only contain extends, vars, and overrides.',
    });
  }
  if (value.extends !== undefined && typeof value.extends !== 'string') {
    throw new ConfigError('"extends" must be a preset name string', {
      code: 'E_TEMPLATE_SHAPE',
      path: sourcePath,
    });
  }
  if (value.vars !== undefined && !isPlainObject(value.vars)) {
    throw new ConfigError('"vars" must be an object', { code: 'E_TEMPLATE_SHAPE', path: sourcePath });
  }
  if (value.overrides !== undefined && !isPlainObject(value.overrides)) {
    throw new ConfigError('"overrides" must be an object', { code: 'E_TEMPLATE_SHAPE', path: sourcePath });
  }
  if (!value.extends && !value.overrides) {
    throw new ConfigError('Config template must contain "extends" or "overrides"', {
      code: 'E_TEMPLATE_SHAPE',
      path: sourcePath,
      hint: 'Use msgtype for a complete message, or overrides with an implicit extends: auto.',
    });
  }

  return {
    kind: 'config',
    message: null,
    // A per-event file that only overrides fields naturally extends the
    // current event's preset.
    extends: value.extends ?? 'auto',
    vars: value.vars ?? {},
    overrides: value.overrides ?? {},
  };
}

function validateEventName(eventName) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(eventName)) {
    throw new ConfigError(`Invalid event name: ${eventName}`, {
      code: 'E_EVENT_NAME',
      hint: 'GitHub event names contain letters, digits, underscores, dots, and hyphens.',
    });
  }
}

/**
 * Find the per-event template in a directory.
 *
 * Accepted names (first match wins; multiple matches are an error):
 *   <event>.yml / <event>.yaml
 *   <prefix>-<event>.yml / <prefix>-<event>.yaml   (e.g. wecom-push.yml)
 *   default.yml / _default.yml (only when no event file exists)
 */
export function findEventTemplate({ workspace, templateDir, eventName }) {
  validateEventName(eventName);
  const dir = resolveWorkspacePath(workspace, templateDir);
  if (!existsSync(dir)) return null;
  let stat;
  try {
    stat = statSync(dir);
  } catch (error) {
    throw new ConfigError(`Could not inspect template directory: ${templateDir}`, {
      code: 'E_TEMPLATE_DIR',
      path: templateDir,
      cause: error,
    });
  }
  if (!stat.isDirectory()) {
    throw new ConfigError(`template-dir is not a directory: ${templateDir}`, {
      code: 'E_TEMPLATE_DIR',
      path: templateDir,
    });
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new ConfigError(`Could not read template directory: ${templateDir}`, {
      code: 'E_TEMPLATE_DIR',
      path: templateDir,
      cause: error,
    });
  }

  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => TEMPLATE_EXTENSIONS.includes(path.extname(name).toLowerCase()));

  const exact = files.filter((name) => {
    const base = name.slice(0, -path.extname(name).length);
    return base === eventName;
  });
  const suffix = files.filter((name) => {
    const base = name.slice(0, -path.extname(name).length);
    return base.endsWith(`-${eventName}`);
  });
  const matches = [...new Set([...exact, ...suffix])];

  if (matches.length > 1) {
    throw new ConfigError(`Multiple templates match event "${eventName}": ${matches.join(', ')}`, {
      code: 'E_TEMPLATE_AMBIGUOUS',
      path: templateDir,
      hint: 'Keep one file per event, e.g. push.yml or wecom-push.yml, but not both.',
    });
  }
  if (matches.length === 1) {
    return path.join(dir, matches[0]);
  }

  const defaults = files.filter((name) => DEFAULT_NAMES.includes(name));
  if (defaults.length > 1) {
    throw new ConfigError(`Multiple default templates found: ${defaults.join(', ')}`, {
      code: 'E_TEMPLATE_AMBIGUOUS',
      path: templateDir,
      hint: 'Use only one of default.yml, default.yaml, _default.yml, or _default.yaml.',
    });
  }
  return defaults.length === 1 ? path.join(dir, defaults[0]) : null;
}

/**
 * Load a complete message or config wrapper from payload, explicit template,
 * or the per-event template directory.
 *
 * @returns {{document: object|null, sourcePath: string|null, sourceKind: 'payload'|'template'|'event-template'|null}}
 */
export function loadConfig({ workspace, inputs, eventName }) {
  if (inputs.payload.trim() !== '') {
    if (inputs.template.trim() !== '') {
      throw new ConfigError('Use either "payload" or "template", not both', {
        code: 'E_TEMPLATE_CONFLICT',
        hint: 'Remove one of the two inputs to avoid ambiguity.',
      });
    }
    const document = parseYamlOrJson(inputs.payload, 'payload input');
    return {
      document: normalizeDocument(document, 'payload input'),
      sourcePath: 'payload input',
      sourceKind: 'payload',
    };
  }

  if (inputs.template.trim() !== '') {
    const filePath = resolveWorkspacePath(workspace, inputs.template);
    const text = readTemplateFile(filePath, inputs.template);
    const document = parseYamlOrJson(text, inputs.template);
    return {
      document: normalizeDocument(document, inputs.template),
      sourcePath: inputs.template,
      sourceKind: 'template',
    };
  }

  if (inputs.templateDir.trim() !== '') {
    const filePath = findEventTemplate({
      workspace,
      templateDir: inputs.templateDir,
      eventName,
    });
    if (filePath) {
      const relative = path.relative(path.resolve(workspace), filePath).split(path.sep).join('/');
      const text = readTemplateFile(filePath, relative);
      const document = parseYamlOrJson(text, relative);
      return {
        document: normalizeDocument(document, relative),
        sourcePath: relative,
        sourceKind: 'event-template',
      };
    }
  }

  return { document: null, sourcePath: null, sourceKind: null };
}

export function parseInlineObject(text, label = 'inline value') {
  if (typeof text !== 'string' || text.trim() === '') return {};
  const value = parseYamlOrJson(text, label);
  if (!isPlainObject(value)) {
    throw new ConfigError(`${label} must be an object`, {
      code: 'E_INLINE_SHAPE',
      path: label,
    });
  }
  return value;
}

export { MAX_TEMPLATE_BYTES, TEMPLATE_EXTENSIONS };
