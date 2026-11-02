import { ConfigError, WeComError } from '../errors.mjs';

const DEFAULT_API_BASE = 'https://qyapi.weixin.qq.com';
const RETRYABLE_ERROR_CODES = new Set([45009]);
const MAX_BACKOFF_MS = 10_000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a webhook URL (or a bare key) into the URL that will receive the POST.
 *
 * We never log the returned URL or key; callers must pass both to
 * `logger.addSecret()` before doing anything else.
 */
export function parseWebhook(webhook, apiBase = DEFAULT_API_BASE) {
  const value = String(webhook ?? '').trim();
  if (!value) {
    throw new ConfigError('The "webhook" input is required unless dry-run is enabled', {
      code: 'E_WEBHOOK_MISSING',
      path: 'webhook',
      hint: 'Set webhook to ${{ secrets.WECOM_WEBHOOK }} (the full URL or just the key).',
    });
  }

  if (/^https?:\/\//iu.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      throw new ConfigError('The "webhook" input is not a valid URL', {
        code: 'E_WEBHOOK_URL',
        path: 'webhook',
        cause: error,
      });
    }
    const key = url.searchParams.get('key');
    if (!key) {
      throw new ConfigError('The webhook URL is missing its "key" query parameter', {
        code: 'E_WEBHOOK_KEY',
        path: 'webhook',
        hint: 'Copy the full webhook URL from the WeCom group robot settings.',
      });
    }
    return { url: url.toString(), key, source: 'url' };
  }

  // A bare key is convenient locally and for custom gateways.
  if (/[\s?#]/u.test(value)) {
    throw new ConfigError('The "webhook" input is neither a URL nor a plain key', {
      code: 'E_WEBHOOK_FORMAT',
      path: 'webhook',
      hint: 'Pass the full https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... URL, or only the key.',
    });
  }

  const base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/u, '');
  const url = `${base}/cgi-bin/webhook/send?key=${encodeURIComponent(value)}`;
  return { url, key: value, source: 'key' };
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt) {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1));
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), MAX_BACKOFF_MS));
  return undefined;
}

async function readResponseBody(response) {
  try {
    const text = await response.text();
    if (!text) return { text: '', json: undefined };
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      return { text, json: undefined };
    }
  } catch {
    return { text: '', json: undefined };
  }
}

function describeFailure({ status, errcode, errmsg, text }) {
  if (errcode !== undefined && Number.isFinite(errcode)) {
    return `WeCom returned errcode ${errcode}${errmsg ? `: ${errmsg}` : ''}`;
  }
  if (status !== undefined) {
    return `WeCom webhook request failed with HTTP ${status}`;
  }
  return `WeCom webhook request failed${text ? `: ${String(text).slice(0, 200)}` : ''}`;
}

/**
 * POST one rendered message to a WeCom group robot.
 *
 * Retries network errors, timeouts, HTTP 5xx/429, and WeCom rate-limit
 * (45009). Business errors such as 93000 are never retried.
 *
 * @returns {Promise<{ok: true, status: number, errcode: number, errmsg: string, attempts: number, durationMs: number}>}
 */
export async function sendToWeCom({
  webhook,
  message,
  apiBase = DEFAULT_API_BASE,
  timeout = 10,
  retries = 2,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  logger,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ConfigError('This runtime does not provide fetch(); Node.js 18 or newer is required', {
      code: 'E_RUNTIME_FETCH',
    });
  }

  const target = parseWebhook(webhook, apiBase);
  if (logger) {
    logger.addSecret(target.url);
    logger.addSecret(target.key);
  }

  const body = JSON.stringify(message);
  const timeoutMs = Math.max(1, Number(timeout) || 10) * 1000;
  const maxAttempts = Math.max(0, Number(retries) || 0) + 1;
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let failure;
    let retryAfter;

    try {
      response = await fetchImpl(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dmao-wecom-notifier',
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      failure = new WeComError(
        aborted ? `WeCom webhook request timed out after ${timeoutMs}ms` : 'Could not reach the WeCom webhook',
        {
          code: aborted ? 'E_TIMEOUT' : 'E_NETWORK',
          retryable: true,
          cause: error,
        },
      );
      failure.attempts = attempt;
    } finally {
      clearTimeout(timer);
    }

    if (!failure && response) {
      const { text, json } = await readResponseBody(response);
      const errcode = Number.isFinite(Number(json?.errcode)) ? Number(json.errcode) : undefined;
      const errmsg = typeof json?.errmsg === 'string' ? json.errmsg : '';

      if (response.ok && errcode === 0) {
        return {
          ok: true,
          status: response.status,
          errcode: 0,
          errmsg: errmsg || 'ok',
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
      }

      const retryable =
        (response.status >= 200 && response.status < 300
          ? RETRYABLE_ERROR_CODES.has(errcode)
          : isRetryableStatus(response.status)) || errcode === 45009;

      failure = new WeComError(describeFailure({ status: response.status, errcode, errmsg, text }), {
        code: errcode === 45009 ? 'E_RATE_LIMIT' : 'E_WECOM_RESPONSE',
        errcode,
        errmsg,
        status: response.status,
        retryable,
      });
      failure.attempts = attempt;
      retryAfter = parseRetryAfter(response.headers?.get?.('retry-after'));
    }

    lastError = failure;
    if (!failure.retryable || attempt >= maxAttempts) {
      break;
    }

    const delay = retryAfter ?? backoffMs(attempt);
    if (logger) {
      logger.warn(
        'W_RETRY',
        `WeCom request failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.ceil(delay / 1000)}s: ${failure.message}`,
      );
    }
    await sleep(delay);
  }

  throw lastError ?? new WeComError('WeCom webhook request failed', { code: 'E_WECOM' });
}

export { DEFAULT_API_BASE, RETRYABLE_ERROR_CODES };
