import { appendFileSync } from 'node:fs';

/**
 * Small logger with GitHub Actions workflow-command support.
 *
 * Secrets are masked once at startup and redacted from every line we print.
 * We never log the raw event payload, inputs, vars, or environment.
 */

function escapeData(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

export class Logger {
  /**
   * @param {{env?: Record<string, string|undefined>, debug?: boolean, stdout?: {write: Function}, stderr?: {write: Function}}} [options]
   */
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.debugEnabled = options.debug ?? false;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.secrets = [];
    this.isActions = String(this.env.GITHUB_ACTIONS ?? '').toLowerCase() === 'true';
  }

  addSecret(value) {
    if (!value || typeof value !== 'string') return;
    const variants = [value];
    try {
      const encoded = encodeURIComponent(value);
      if (encoded !== value) variants.push(encoded);
    } catch {
      // ignore malformed input
    }
    for (const variant of variants) {
      if (variant.length < 4 || this.secrets.includes(variant)) continue;
      this.secrets.push(variant);
      if (this.isActions) {
        this.stdout.write(`::add-mask::${escapeData(variant)}\n`);
      }
    }
  }

  redact(value) {
    let text = String(value ?? '');
    for (const secret of this.secrets) {
      if (!secret) continue;
      text = text.split(secret).join('***');
    }
    return text;
  }

  info(message) {
    this.stdout.write(`${this.redact(message)}\n`);
  }

  debug(message) {
    if (!this.debugEnabled) return;
    this.info(`[debug] ${message}`);
  }

  warn(code, message, path) {
    const text = this.redact(path ? `${message} (${path})` : message);
    if (this.isActions) {
      const title = code ? `WeCom Notifier ${code}` : 'WeCom Notifier';
      this.stderr.write(`::warning title=${escapeProperty(title)}::${escapeData(text)}\n`);
    } else {
      this.stderr.write(`warning${code ? ` [${code}]` : ''}: ${text}\n`);
    }
  }

  error(code, message, path) {
    const text = this.redact(path ? `${message} (${path})` : message);
    if (this.isActions) {
      const title = code ? `WeCom Notifier ${code}` : 'WeCom Notifier';
      this.stderr.write(`::error title=${escapeProperty(title)}::${escapeData(text)}\n`);
    } else {
      this.stderr.write(`error${code ? ` [${code}]` : ''}: ${text}\n`);
    }
  }

  /**
   * Append a markdown summary. In Actions this goes to GITHUB_STEP_SUMMARY;
   * locally it is printed so `--dry-run` still shows a useful report.
   */
  summary(markdown) {
    const text = this.redact(String(markdown ?? ''));
    const summaryPath = this.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, `${text}\n`, 'utf8');
        return;
      } catch {
        // Fall through to stdout; a summary failure should not fail the action.
      }
    }
    this.stdout.write(`${text}\n`);
  }
}

export function escapeWorkflowCommandData(value) {
  return escapeData(value);
}

export function escapeWorkflowCommandProperty(value) {
  return escapeProperty(value);
}
