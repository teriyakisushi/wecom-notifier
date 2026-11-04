import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Logger, escapeWorkflowCommandData, escapeWorkflowCommandProperty } from '../src/log.mjs';

function sink() {
  const chunks = [];
  return {
    chunks,
    write(text) {
      chunks.push(String(text));
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

function makeLogger(env = {}, debug = false) {
  const stdout = sink();
  const stderr = sink();
  const logger = new Logger({ env, debug, stdout, stderr });
  return { logger, stdout, stderr };
}

test('info, warn, and error use plain formatting outside Actions', () => {
  const { logger, stdout, stderr } = makeLogger();
  logger.info('hello');
  logger.warn('W_FIELD_LENGTH', 'too long', 'template_card.main_title');
  logger.error('E_SEND', 'boom');
  assert.equal(stdout.text(), 'hello\n');
  assert.equal(
    stderr.text(),
    'warning [W_FIELD_LENGTH]: too long (template_card.main_title)\nerror [E_SEND]: boom\n',
  );
});

test('debug output is gated by the debug flag', () => {
  const quiet = makeLogger();
  quiet.logger.debug('hidden');
  assert.equal(quiet.stdout.text(), '');

  const loud = makeLogger({}, true);
  loud.logger.debug('shown');
  assert.equal(loud.stdout.text(), '[debug] shown\n');
});

test('secrets are masked from every line', () => {
  const { logger, stdout, stderr } = makeLogger();
  logger.addSecret('s3cr3t-value');
  logger.info('using s3cr3t-value here');
  logger.warn('W', 'echo s3cr3t-value');
  assert.ok(!stdout.text().includes('s3cr3t-value'));
  assert.ok(!stderr.text().includes('s3cr3t-value'));
  assert.ok(stdout.text().includes('using *** here'));
});

test('short and duplicate secrets are not registered', () => {
  const { logger } = makeLogger();
  logger.addSecret('ab');
  logger.addSecret('');
  logger.addSecret(undefined);
  logger.addSecret('s3cr3t-value');
  logger.addSecret('s3cr3t-value');
  assert.deepEqual(logger.secrets, ['s3cr3t-value']);
});

test('the encoded variant of a secret is masked too', () => {
  const { logger, stdout } = makeLogger();
  logger.addSecret('key with space');
  logger.info('raw key with space and encoded key%20with%20space');
  const text = stdout.text();
  assert.ok(!text.includes('key with space'));
  assert.ok(!text.includes('key%20with%20space'));
  assert.equal(text.trim().split(' and ').length, 2);
});

test('Actions mode emits workflow commands', () => {
  const { logger, stdout, stderr } = makeLogger({ GITHUB_ACTIONS: 'true' });
  logger.addSecret('s3cr3t-value');
  logger.warn('W_FIELD_LENGTH', 'line1\nline2 100%', 'a:b,c');
  logger.error('E_SEND', 'bad, really');
  const out = stdout.text();
  assert.ok(out.includes('::add-mask::s3cr3t-value'));
  assert.ok(stderr.text().includes('::warning title=WeCom Notifier W_FIELD_LENGTH::line1%0Aline2 100%25 (a:b,c)'));
  assert.ok(stderr.text().includes('::error title=WeCom Notifier E_SEND::bad, really'));
});

test('Actions mode omits the title when no code is given', () => {
  const { logger, stderr } = makeLogger({ GITHUB_ACTIONS: 'true' });
  logger.warn(undefined, 'heads up');
  logger.error(undefined, 'nope');
  assert.ok(stderr.text().includes('::warning title=WeCom Notifier::heads up'));
  assert.ok(stderr.text().includes('::error title=WeCom Notifier::nope'));
});

test('summary appends to GITHUB_STEP_SUMMARY when available', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wecom-summary-'));
  const summaryPath = path.join(dir, 'summary.md');
  const { logger, stdout } = makeLogger({ GITHUB_STEP_SUMMARY: summaryPath });
  logger.summary('| a | b |');
  logger.summary('| 1 | 2 |');
  assert.equal(stdout.text(), '');
  assert.ok(readFileSync(summaryPath, 'utf8').includes('| 1 | 2 |'));
  rmSync(dir, { recursive: true, force: true });
});

test('summary falls back to stdout when the file is unwritable', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wecom-summary-'));
  const { logger, stdout } = makeLogger({ GITHUB_STEP_SUMMARY: dir });
  logger.summary('fallback text');
  assert.equal(stdout.text(), 'fallback text\n');
  rmSync(dir, { recursive: true, force: true });
});

test('workflow command escaping helpers', () => {
  assert.equal(escapeWorkflowCommandData('a%b\r\nc'), 'a%25b%0D%0Ac');
  assert.equal(escapeWorkflowCommandProperty('a:b,c%'), 'a%3Ab%2Cc%25');
});
