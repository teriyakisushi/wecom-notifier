/**
 * Error types used across the action.
 *
 * Every user-facing failure should throw one of these so the CLI/action can
 * print a concise message without a stack trace (unless --debug is enabled).
 */

export class NotifierError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, path?: string, hint?: string, cause?: unknown}} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'NotifierError';
    this.code = options.code ?? 'E_NOTIFIER';
    this.path = options.path;
    this.hint = options.hint;
  }
}

export class ConfigError extends NotifierError {
  constructor(message, options = {}) {
    super(message, { code: 'E_CONFIG', ...options });
    this.name = 'ConfigError';
  }
}

export class TemplateError extends NotifierError {
  constructor(message, options = {}) {
    super(message, { code: 'E_TEMPLATE', ...options });
    this.name = 'TemplateError';
  }
}

export class ValidationError extends NotifierError {
  /**
   * @param {string} message
   * @param {Array<{level: 'error'|'warning', code: string, path?: string, message: string, hint?: string}>} issues
   * @param {{code?: string, hint?: string}} [options]
   */
  constructor(message, issues = [], options = {}) {
    super(message, { code: 'E_VALIDATION', ...options });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class WeComError extends NotifierError {
  /**
   * @param {string} message
   * @param {{errcode?: number, errmsg?: string, status?: number, retryable?: boolean, code?: string, hint?: string}} [options]
   */
  constructor(message, options = {}) {
    super(message, { code: 'E_WECOM', ...options });
    this.name = 'WeComError';
    this.errcode = options.errcode;
    this.errmsg = options.errmsg;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export function isNotifierError(error) {
  return error instanceof NotifierError;
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
