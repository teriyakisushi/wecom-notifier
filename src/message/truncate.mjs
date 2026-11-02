import { byteLength, fitBytes } from '../util.mjs';

const LIMITS = {
  text: 2048,
  markdown: 4096,
  markdown_v2: 4096,
};

function warning(code, message, path) {
  return { level: 'warning', code, message, path };
}

function fitField(target, key, max, path, warnings) {
  const value = target[key];
  if (typeof value !== 'string') return;
  if (byteLength(value) <= max) return;
  target[key] = fitBytes(value, max);
  warnings.push(warning('W_TRUNCATED', `Truncated ${path} to ${max} bytes`, path));
}

/**
 * Apply the byte limits that WeCom enforces by truncating (text, markdown,
 * news titles/descriptions). Other limits are validated, not silently cut.
 */
export function truncateMessage(message) {
  const warnings = [];
  const output = JSON.parse(JSON.stringify(message));

  if (output.msgtype === 'text' || output.msgtype === 'markdown' || output.msgtype === 'markdown_v2') {
    const body = output[output.msgtype];
    if (body && typeof body === 'object') {
      fitField(body, 'content', LIMITS[output.msgtype], `${output.msgtype}.content`, warnings);
    }
  }

  if (output.msgtype === 'news' && Array.isArray(output.news?.articles)) {
    output.news.articles.forEach((article, index) => {
      fitField(article, 'title', 128, `news.articles[${index}].title`, warnings);
      fitField(article, 'description', 512, `news.articles[${index}].description`, warnings);
    });
  }

  return { message: output, warnings };
}
