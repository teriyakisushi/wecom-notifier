import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildContext } from './context.mjs';
import { loadConfig, parseInlineObject } from './config.mjs';
import { ConfigError, ValidationError, WeComError, isNotifierError } from './errors.mjs';
import { parseInputs, flatInputs, getEventName } from './inputs.mjs';
import { Logger } from './log.mjs';
import { normalizeMessage } from './message/normalize.mjs';
import { truncateMessage } from './message/truncate.mjs';
import { validateMessage } from './message/validate.mjs';
import { parseWebhook, sendToWeCom } from './message/send.mjs';
import { getPreset, resolvePresetName } from './presets/index.mjs';
import { writePreviewHtml } from './preview/html.mjs';
import { renderMessage } from './template/render.mjs';
import {
  byteLength,
  clone,
  deepMerge,
  isPlainObject,
  pruneEmpty,
  toBoolean,
} from './util.mjs';

const FLAT_PRESETS = new Set(['text', 'markdown', 'card']);
const OUTPUT_LIMIT = 64 * 1024;
const DRY_RUN_PRINT_LIMIT = 16 * 1024;

function readEventFile(eventPath, cwd) {
  if (!eventPath) return {};
  const resolved = path.isAbsolute(eventPath) ? eventPath : path.resolve(cwd, eventPath);
  if (!existsSync(resolved)) {
    throw new ConfigError(`Event payload file not found: ${eventPath}`, {
      code: 'E_EVENT_FILE',
      path: eventPath,
      hint: 'Pass --event <file> locally, or run inside GitHub Actions where GITHUB_EVENT_PATH is set.',
    });
  }
  let text;
  try {
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read event payload: ${eventPath}`, {
      code: 'E_EVENT_FILE',
      path: eventPath,
      cause: error,
    });
  }
  try {
    const event = JSON.parse(text);
    if (!isPlainObject(event)) {
      throw new ConfigError('The event payload must be a JSON object', {
        code: 'E_EVENT_FILE',
        path: eventPath,
      });
    }
    return event;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`The event payload is not valid JSON: ${eventPath}`, {
      code: 'E_EVENT_FILE',
      path: eventPath,
      cause: error,
    });
  }
}

function parseVars(inputs) {
  const text = String(inputs.vars ?? '').trim();
  if (!text) return {};
  const parsed = parseInlineObject(text, 'vars input');
  if (!isPlainObject(parsed)) {
    throw new ConfigError('The "vars" input must be a mapping', {
      code: 'E_VARS_SHAPE',
      path: 'vars',
      hint: 'Pass a YAML/JSON object, e.g. {"env":"production"}.',
    });
  }
  return parsed;
}

function validateConfigVars(vars) {
  if (vars === undefined) return {};
  if (!isPlainObject(vars)) {
    throw new ConfigError('"vars" in a template must be a mapping', {
      code: 'E_VARS_SHAPE',
      path: 'vars',
    });
  }
  return vars;
}

function resolveBaseMessage({ document, inputs, ctx, eventName }) {
  if (document?.kind === 'message') {
    return { message: clone(document.message), origin: 'inline message', flat: false };
  }

  const requested = document?.extends ?? inputs.preset;
  const presetName = resolvePresetName(requested, eventName);
  if (presetName === 'none') {
    return { message: {}, origin: 'none', flat: false };
  }

  const useFlat = FLAT_PRESETS.has(presetName);
  const message = getPreset(presetName, {
    ctx,
    inputs: useFlat ? flatInputs(inputs) : inputs,
    eventName,
  });

  return { message, origin: `preset:${presetName}`, flat: useFlat };
}

function outputValue(name, value, env) {
  const target = env.GITHUB_OUTPUT;
  if (!target) return;
  const text = String(value ?? '');
  if (!text.includes('\n')) {
    appendFileSync(target, `${name}=${text}\n`, 'utf8');
    return;
  }
  const delimiter = `ghadelimiter_${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  appendFileSync(target, `${name}<<${delimiter}\n${text}\n${delimiter}\n`, 'utf8');
}

function truncateForOutput(text, limit) {
  if (byteLength(text) <= limit) return text;
  const suffix = '\n… [truncated for GitHub output]';
  const target = limit - byteLength(suffix);
  // Slice by code points, then trim any partial UTF-8 sequence by re-encoding.
  let result = '';
  for (const char of text) {
    if (byteLength(result + char) > target) break;
    result += char;
  }
  return `${result}${suffix}`;
}

function makeSummary({ inputs, eventName, origin, msgtype, size, status, errcode, errmsg, warnings }) {
  const rows = [
    ['事件', eventName],
    ['预设/来源', origin],
    ['消息类型', msgtype],
    ['大小', `${(size / 1024).toFixed(1)} KB`],
    ['状态', status],
  ];
  if (errcode !== undefined) rows.push(['errcode', String(errcode)]);
  if (errmsg) rows.push(['errmsg', String(errmsg).slice(0, 120)]);
  if (warnings?.length) rows.push(['警告', `${warnings.length} 条（详见日志）`]);
  const lines = ['', '| 项目 | 值 |', '| --- | --- |'];
  for (const [key, value] of rows) {
    lines.push(`| ${key} | ${String(value).replaceAll('|', '\\|')} |`);
  }
  return lines.join('\n');
}

function formatError(error) {
  if (error instanceof ValidationError && Array.isArray(error.issues)) {
    return error.issues.map((issue) => `${issue.code}${issue.path ? ` (${issue.path})` : ''}: ${issue.message}`);
  }
  return [];
}

/**
 * Orchestrate one notification run.
 *
 * Exported separately from `main` so tests can call it with a fake fetch and
 * a temporary working directory.
 */
export async function runNotify({
  env = process.env,
  cli = {},
  cwd = process.cwd(),
  now = new Date(),
  logger = new Logger({ env }),
  fetchImpl = globalThis.fetch,
  sleep,
} = {}) {
  const inputs = parseInputs({ env, cli });
  logger.debugEnabled = Boolean(inputs.debug);
  if (inputs.webhook) {
    logger.addSecret(inputs.webhook);
    try {
      const target = parseWebhook(inputs.webhook, inputs.apiBase);
      logger.addSecret(target.key);
    } catch {
      // A malformed webhook is reported with a proper error below.
    }
  }

  const eventName = getEventName({ env, cli });
  const workspace = env.GITHUB_WORKSPACE || cwd;
  const eventPath = cli.eventPath ?? cli.event ?? env.GITHUB_EVENT_PATH;
  logger.debug(`event=${eventName} workspace=${workspace}`);

  const event = readEventFile(eventPath, cwd);
  const config = loadConfig({ workspace, inputs, eventName });

  // Config vars are available in the template; the "vars" input wins.
  const inputVars = parseVars(inputs);
  const documentVars = validateConfigVars(config.document?.kind === 'config' ? config.document.vars : undefined);
  const vars = { ...documentVars, ...inputVars };

  const ctx = buildContext({
    eventName,
    event,
    env,
    inputs: { ...inputs, vars },
    now,
  });

  const base = resolveBaseMessage({ document: config.document, inputs, ctx, eventName });

  let message = base.message;
  if (config.document?.kind === 'config') {
    message = deepMerge(message, config.document.overrides);
  }
  const inputOverrides = parseVarsLike(inputs.overrides, 'overrides input');
  if (Object.keys(inputOverrides).length > 0) {
    message = deepMerge(message, inputOverrides);
  }

  if (!isPlainObject(message) || Object.keys(message).length === 0) {
    throw new ConfigError('No message was produced', {
      code: 'E_MESSAGE_EMPTY',
      path: 'payload/preset',
      hint: 'Provide payload, a template, or a preset such as card; preset "none" needs overrides or a template.',
    });
  }

  const rendered = renderMessage(message, ctx);
  const warnings = [...rendered.warnings];
  const pruned = pruneEmpty(rendered.value);
  if (!isPlainObject(pruned) || Object.keys(pruned).length === 0) {
    throw new ConfigError('The rendered message is empty', {
      code: 'E_MESSAGE_EMPTY',
      path: 'payload',
    });
  }

  const normalized = normalizeMessage(pruned);
  warnings.push(...normalized.warnings);
  const finalMessage = normalized.message;

  let final = finalMessage;
  if (inputs.autoTruncate) {
    const truncated = truncateMessage(finalMessage);
    final = truncated.message;
    warnings.push(...truncated.warnings);
  }

  const validation = validateMessage(final, { warnings });
  warnings.length = 0;
  warnings.push(...validation.warnings);

  const payloadText = JSON.stringify(final, null, 2);
  const size = byteLength(payloadText);

  const previewPath = writePreview({ inputs, final, warnings, eventName, origin: base.origin, size, cwd, now, logger });

  if (!validation.ok) {
    if (inputs.failOnError) {
      throw new ValidationError(
        `Message validation failed with ${validation.errors.length} error(s)`,
        validation.errors,
        { hint: 'Fix the message template; validation failures are never sent.' },
      );
    }
    for (const issue of validation.errors) {
      logger.warn(issue.code, issue.message, issue.path);
    }
    const result = {
      ok: false,
      status: 'invalid',
      eventName,
      origin: base.origin,
      msgtype: final.msgtype,
      message: final,
      payload: payloadText,
      warnings,
      errors: validation.errors,
      errcode: undefined,
      errmsg: undefined,
      dryRun: inputs.dryRun,
      previewPath,
    };
    writeResult({ inputs, env, result, payloadText, logger });
    return result;
  }

  for (const warning of warnings) {
    logger.warn(warning.code, warning.message, warning.path);
  }

  let sendResult = null;
  if (inputs.dryRun) {
    logger.info(`[dry-run] ${eventName} -> ${base.origin} -> ${final.msgtype} (${size} bytes)`);
  } else {
    if (!inputs.webhook) {
      throw new ConfigError('The "webhook" input is required unless dry-run is enabled', {
        code: 'E_WEBHOOK_MISSING',
        path: 'webhook',
      });
    }
    try {
      sendResult = await sendToWeCom({
        webhook: inputs.webhook,
        message: final,
        apiBase: inputs.apiBase,
        timeout: inputs.timeout,
        retries: inputs.retries,
        fetchImpl,
        sleep,
        logger,
      });
      logger.info(`Sent ${final.msgtype} to WeCom (${size} bytes, attempt(s): ${sendResult.attempts})`);
    } catch (error) {
      if (!inputs.failOnError) {
        logger.warn(error.code ?? 'E_WECOM', error.message, error.path);
        sendResult = {
          ok: false,
          errcode: error.errcode,
          errmsg: error.errmsg ?? error.message,
          attempts: error.attempts,
        };
      } else {
        throw error;
      }
    }
  }

  const result = {
    ok: sendResult ? sendResult.ok !== false : true,
    status: inputs.dryRun ? 'dry-run' : sendResult?.ok === false ? 'failed' : 'sent',
    eventName,
    origin: base.origin,
    msgtype: final.msgtype,
    message: final,
    payload: payloadText,
    warnings,
    errors: [],
    errcode: sendResult?.errcode,
    errmsg: sendResult?.errmsg,
    attempts: sendResult?.attempts,
    dryRun: inputs.dryRun,
    previewPath,
  };

  writeResult({ inputs, env, result, payloadText, logger });
  return result;
}

function parseVarsLike(text, label) {
  const value = String(text ?? '').trim();
  if (!value) return {};
  const parsed = parseInlineObject(value, label);
  if (!isPlainObject(parsed)) {
    throw new ConfigError(`The "${label.replace(/ input$/u, '')}" input must be a mapping`, {
      code: 'E_VARS_SHAPE',
      path: label,
    });
  }
  return parsed;
}

/**
 * Optional local debugging aid: dump the rendered message as an HTML page.
 * Silently skipped when the `html` input is empty.
 */
function writePreview({ inputs, final, warnings, eventName, origin, size, cwd, now, logger }) {
  const file = String(inputs.html ?? '').trim();
  if (!file) return undefined;
  const target = writePreviewHtml({
    file,
    cwd,
    message: final,
    eventName,
    origin,
    warnings,
    bytes: size,
    generatedAt: now,
  });
  logger.info(`[preview] wrote ${target}`);
  return target;
}

function writeResult({ inputs, env, result, payloadText, logger }) {
  const outputText = truncateForOutput(payloadText, OUTPUT_LIMIT);
  if (outputText !== payloadText) {
    logger.warn(
      'W_OUTPUT_LIMIT',
      `The rendered payload (${payloadText.length} bytes) exceeds the ${OUTPUT_LIMIT}-byte output limit and was truncated`,
      'payload',
    );
  }
  outputValue('msgtype', result.msgtype ?? '', env);
  outputValue('payload', outputText, env);
  outputValue('errcode', result.errcode === undefined ? '' : result.errcode, env);
  outputValue('errmsg', result.errmsg ?? '', env);

  if (!env.GITHUB_OUTPUT && result.dryRun) {
    if (byteLength(payloadText) <= DRY_RUN_PRINT_LIMIT) {
      process.stdout.write(`${payloadText}\n`);
    } else {
      logger.info(
        `[dry-run] payload is ${byteLength(payloadText)} bytes; set GITHUB_OUTPUT or use --template locally to inspect it fully`,
      );
    }
  }

  logger.summary(
    makeSummary({
      inputs,
      eventName: result.eventName,
      origin: result.origin,
      msgtype: result.msgtype,
      size: byteLength(payloadText),
      status: result.status,
      errcode: result.errcode,
      errmsg: result.errmsg,
      warnings: result.warnings,
    }),
  );
}

/**
 * CLI/Action entry point. Catches NotifierErrors and turns them into a clean
 * log line plus a failure exit code (unless fail-on-error is false).
 */
export async function main({ env = process.env, cli = {}, cwd = process.cwd(), now = new Date() } = {}) {
  let inputs;
  let logger;
  try {
    inputs = parseInputs({ env, cli });
    logger = new Logger({ env, debug: inputs.debug });
    const result = await runNotify({ env, cli, cwd, now, logger });
    if (!result.ok && inputs.failOnError) {
      process.exitCode = 1;
    }
    return result;
  } catch (error) {
    logger ??= new Logger({ env, debug: toBoolean(env.INPUT_DEBUG, false) });
    const failOnError = inputs?.failOnError ?? toBoolean(env.INPUT_FAIL_ON_ERROR, true);
    const code = isNotifierError(error) ? error.code : 'E_UNEXPECTED';
    logger.error(code, error?.message ?? String(error), error?.path);
    if (error?.hint) logger.info(`hint: ${error.hint}`);
    for (const line of formatError(error)) logger.error('E_VALIDATION', line);
    if (inputs?.debug && error?.stack) logger.debug(error.stack);
    if (failOnError) process.exitCode = 1;
    return {
      ok: false,
      status: 'error',
      error: {
        code,
        message: error?.message ?? String(error),
        path: error?.path,
        hint: error?.hint,
        issues: error?.issues,
      },
    };
  }
}
