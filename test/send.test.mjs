import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWebhook, sendToWeCom } from '../src/message/send.mjs';
import { WeComError } from '../src/errors.mjs';

function response({ status = 200, body = { errcode: 0, errmsg: 'ok' }, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function message() {
  return { msgtype: 'text', text: { content: 'hello' } };
}

test('parses full webhook URLs and bare keys', () => {
  const full = parseWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123');
  assert.equal(full.key, 'abc-123');
  assert.equal(full.source, 'url');
  assert.match(full.url, /key=abc-123/u);

  const key = parseWebhook('abc-123', 'https://gateway.example.com');
  assert.equal(key.source, 'key');
  assert.equal(key.url, 'https://gateway.example.com/cgi-bin/webhook/send?key=abc-123');
});

test('rejects blank and malformed webhooks', () => {
  assert.throws(() => parseWebhook(''), /webhook.*required/i);
  assert.throws(() => parseWebhook('not a key!'), /neither a URL nor a plain key/);
});

test('sends a message and returns the WeCom response', async () => {
  const calls = [];
  const result = await sendToWeCom({
    webhook: 'key-1',
    message: message(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.errcode, 0);
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).text.content, 'hello');
});

test('retries 45009 and 5xx responses', async () => {
  const sleeps = [];
  let attempt = 0;
  const result = await sendToWeCom({
    webhook: 'key-2',
    message: message(),
    retries: 2,
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) return response({ status: 200, body: { errcode: 45009, errmsg: 'rate limited' } });
      if (attempt === 2) return response({ status: 503, body: '' });
      return response();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('does not retry business errors such as 93000', async () => {
  let calls = 0;
  const error = await sendToWeCom({
    webhook: 'key-3',
    message: message(),
    retries: 5,
    fetchImpl: async () => {
      calls += 1;
      return response({ status: 200, body: { errcode: 93000, errmsg: 'invalid webhook url' } });
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof WeComError);
  assert.equal(error.code, 'E_WECOM_RESPONSE');
  assert.equal(error.errcode, 93000);
  assert.equal(error.retryable, false);
  assert.equal(calls, 1);
});

test('classifies aborted requests as timeouts', async () => {
  const error = await sendToWeCom({
    webhook: 'key-4',
    message: message(),
    timeout: 1,
    retries: 0,
    fetchImpl: async () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof WeComError);
  assert.equal(error.code, 'E_TIMEOUT');
  assert.equal(error.retryable, true);
});
