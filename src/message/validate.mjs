import crypto from 'node:crypto';

import { ValidationError } from '../errors.mjs';
import { byteLength, codePointLength, isHttpUrl, isPlainObject } from '../util.mjs';

const TEXT_LIMIT = 2048;
const MARKDOWN_LIMIT = 4096;
const IMAGE_BYTES = 2 * 1024 * 1024;

const CARD_TYPES = new Set(['text_notice', 'news_notice']);
const HORIZONTAL_LIMIT = 6;
const JUMP_LIMIT = 3;
const NEWS_MIN = 1;
const NEWS_MAX = 8;

const MD5_RE = /^[a-f0-9]{32}$/u;

function issue(level, code, message, path, hint) {
  const item = { level, code, message, path };
  if (hint) item.hint = hint;
  return item;
}

function error(code, message, path, hint) {
  return issue('error', code, message, path, hint);
}

function warn(code, message, path, hint) {
  return issue('warning', code, message, path, hint);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkString(value, path, errors, { required = true, code = 'E_FIELD_TYPE' } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(error(code, `${path} is required`, path));
    return false;
  }
  if (typeof value !== 'string') {
    errors.push(error(code, `${path} must be a string`, path));
    return false;
  }
  if (required && value.trim() === '') {
    errors.push(error(code, `${path} must not be empty`, path));
    return false;
  }
  return true;
}

function checkUrl(value, path, errors, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(error('E_URL_REQUIRED', `${path} is required`, path));
    return false;
  }
  if (typeof value !== 'string' || !isHttpUrl(value)) {
    errors.push(error('E_URL_INVALID', `${path} must be an http(s) URL`, path));
    return false;
  }
  return true;
}

function checkCharLimit(value, max, path, errors, warnings, { level = 'warning', label = 'recommended' } = {}) {
  if (typeof value !== 'string') return;
  if (codePointLength(value) > max) {
    const item = issue(
      level,
      level === 'error' ? 'E_FIELD_LENGTH' : 'W_FIELD_LENGTH',
      `${path} is longer than the ${label} limit of ${max} characters`,
      path,
      level === 'error' ? undefined : 'WeCom may truncate or reject this field.',
    );
    (level === 'error' ? errors : warnings).push(item);
  }
}

function validateText(message, errors, warnings) {
  const body = message.text;
  if (!isPlainObject(body)) {
    errors.push(error('E_BODY', 'text body must be an object', 'text'));
    return;
  }
  if (checkString(body.content, 'text.content', errors)) {
    const bytes = byteLength(body.content);
    if (bytes > TEXT_LIMIT) {
      errors.push(
        error('E_TEXT_TOO_LONG', `text.content is ${bytes} bytes; the limit is ${TEXT_LIMIT} bytes`, 'text.content'),
      );
    }
  }
  for (const key of ['mentioned_list', 'mentioned_mobile_list']) {
    if (body[key] === undefined) continue;
    if (!Array.isArray(body[key]) || body[key].some((item) => typeof item !== 'string')) {
      errors.push(error('E_MENTION', `${key} must be an array of strings`, `text.${key}`));
    }
  }
}

function validateMarkdown(message, errors) {
  const type = message.msgtype;
  const body = message[type];
  if (!isPlainObject(body)) {
    errors.push(error('E_BODY', `${type} body must be an object`, type));
    return;
  }
  if (checkString(body.content, `${type}.content`, errors)) {
    const bytes = byteLength(body.content);
    if (bytes > MARKDOWN_LIMIT) {
      errors.push(
        error('E_MARKDOWN_TOO_LONG', `${type}.content is ${bytes} bytes; the limit is ${MARKDOWN_LIMIT} bytes`, `${type}.content`),
      );
    }
  }
}

function validateImage(message, errors) {
  const body = message.image;
  if (!isPlainObject(body)) {
    errors.push(error('E_BODY', 'image body must be an object', 'image'));
    return;
  }
  if (!checkString(body.base64, 'image.base64', errors)) return;
  let bytes;
  try {
    bytes = Buffer.from(body.base64, 'base64');
  } catch (cause) {
    errors.push(error('E_IMAGE_BASE64', 'image.base64 is not valid base64', 'image.base64'));
    return;
  }
  if (!bytes.length) {
    errors.push(error('E_IMAGE_BASE64', 'image.base64 decodes to an empty image', 'image.base64'));
    return;
  }
  if (bytes.length > IMAGE_BYTES) {
    errors.push(
      error(
        'E_IMAGE_TOO_LARGE',
        `image is ${bytes.length} bytes; the limit is ${IMAGE_BYTES} bytes (2 MB before base64 encoding)`,
        'image.base64',
      ),
    );
  }
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!png && !jpg) {
    errors.push(error('E_IMAGE_FORMAT', 'image must be JPG or PNG', 'image.base64'));
  }
  if (!checkString(body.md5, 'image.md5', errors)) return;
  if (!MD5_RE.test(body.md5)) {
    errors.push(error('E_IMAGE_MD5', 'image.md5 must be a 32-character lowercase hex digest', 'image.md5'));
    return;
  }
  const computed = crypto.createHash('md5').update(bytes).digest('hex');
  if (computed !== body.md5) {
    errors.push(
      error('E_IMAGE_MD5_MISMATCH', 'image.md5 does not match image.base64', 'image.md5', 'Use the MD5 of the decoded image bytes.'),
    );
  }
}

function validateNews(message, errors, warnings) {
  const body = message.news;
  if (!isPlainObject(body)) {
    errors.push(error('E_BODY', 'news body must be an object', 'news'));
    return;
  }
  if (!Array.isArray(body.articles)) {
    errors.push(error('E_NEWS_ARTICLES', 'news.articles must be an array', 'news.articles'));
    return;
  }
  if (body.articles.length < NEWS_MIN || body.articles.length > NEWS_MAX) {
    errors.push(
      error('E_NEWS_COUNT', `news.articles must contain 1-${NEWS_MAX} articles`, 'news.articles'),
    );
  }
  body.articles.forEach((article, index) => {
    const path = `news.articles[${index}]`;
    if (!isPlainObject(article)) {
      errors.push(error('E_ARTICLE', `${path} must be an object`, path));
      return;
    }
    if (checkString(article.title, `${path}.title`, errors)) {
      const bytes = byteLength(article.title);
      if (bytes > 128) {
        errors.push(error('E_ARTICLE_TITLE', `${path}.title is ${bytes} bytes; the limit is 128 bytes`, `${path}.title`));
      }
    }
    if (article.description !== undefined) {
      if (checkString(article.description, `${path}.description`, errors, { required: false })) {
        const bytes = byteLength(article.description);
        if (bytes > 512) {
          errors.push(
            error('E_ARTICLE_DESC', `${path}.description is ${bytes} bytes; the limit is 512 bytes`, `${path}.description`),
          );
        }
      }
    }
    checkUrl(article.url, `${path}.url`, errors);
    if (article.picurl !== undefined && article.picurl !== '') {
      checkUrl(article.picurl, `${path}.picurl`, errors, { required: false });
    }
  });
}

function validateMedia(message, errors) {
  const type = message.msgtype;
  const body = message[type];
  if (!isPlainObject(body)) {
    errors.push(error('E_BODY', `${type} body must be an object`, type));
    return;
  }
  checkString(body.media_id, `${type}.media_id`, errors);
}

function checkAction(action, path, errors) {
  if (!isPlainObject(action)) {
    errors.push(error('E_CARD_ACTION', `${path} is required`, path));
    return;
  }
  if (action.type !== 1 && action.type !== 2) {
    errors.push(error('E_CARD_ACTION_TYPE', `${path}.type must be 1 (URL) or 2 (mini program)`, `${path}.type`));
    return;
  }
  if (action.type === 1) {
    checkUrl(action.url, `${path}.url`, errors);
  } else {
    checkString(action.appid, `${path}.appid`, errors);
    checkString(action.pagepath, `${path}.pagepath`, errors);
  }
}

function checkSource(source, errors, warnings) {
  if (source === undefined) return;
  if (!isPlainObject(source)) {
    errors.push(error('E_SOURCE', 'template_card.source must be an object', 'template_card.source'));
    return;
  }
  if (source.desc !== undefined) {
    checkString(source.desc, 'template_card.source.desc', errors, { required: false });
    checkCharLimit(source.desc, 13, 'template_card.source.desc', errors, warnings);
  }
  if (source.desc_color !== undefined) {
    if (!Number.isInteger(source.desc_color) || source.desc_color < 0 || source.desc_color > 3) {
      errors.push(error('E_SOURCE_COLOR', 'template_card.source.desc_color must be an integer 0-3', 'template_card.source.desc_color'));
    }
  }
  if (source.icon_url !== undefined && source.icon_url !== '') {
    checkUrl(source.icon_url, 'template_card.source.icon_url', errors, { required: false });
  }
}

function checkTitleAndDesc(card, errors, warnings) {
  if (card.main_title === undefined) return;
  if (!isPlainObject(card.main_title)) {
    errors.push(error('E_MAIN_TITLE', 'template_card.main_title must be an object', 'template_card.main_title'));
    return;
  }
  if (card.main_title.title !== undefined) {
    checkString(card.main_title.title, 'template_card.main_title.title', errors, { required: false });
    checkCharLimit(card.main_title.title, 26, 'template_card.main_title.title', errors, warnings);
  }
  if (card.main_title.desc !== undefined) {
    checkString(card.main_title.desc, 'template_card.main_title.desc', errors, { required: false });
    checkCharLimit(card.main_title.desc, 30, 'template_card.main_title.desc', errors, warnings);
  }
  if (card.emphasis_content !== undefined) {
    if (!isPlainObject(card.emphasis_content)) {
      errors.push(error('E_EMPHASIS', 'template_card.emphasis_content must be an object', 'template_card.emphasis_content'));
    } else {
      if (card.emphasis_content.title !== undefined) {
        checkString(card.emphasis_content.title, 'template_card.emphasis_content.title', errors, { required: false });
        checkCharLimit(card.emphasis_content.title, 10, 'template_card.emphasis_content.title', errors, warnings);
      }
      if (card.emphasis_content.desc !== undefined) {
        checkString(card.emphasis_content.desc, 'template_card.emphasis_content.desc', errors, { required: false });
        checkCharLimit(card.emphasis_content.desc, 15, 'template_card.emphasis_content.desc', errors, warnings);
      }
    }
  }
  if (card.sub_title_text !== undefined) {
    if (checkString(card.sub_title_text, 'template_card.sub_title_text', errors, { required: false })) {
      checkCharLimit(card.sub_title_text, 112, 'template_card.sub_title_text', errors, warnings);
    }
  }
}

function checkQuoteArea(quote, errors, warnings) {
  if (quote === undefined) return;
  if (!isPlainObject(quote)) {
    errors.push(error('E_QUOTE', 'template_card.quote_area must be an object', 'template_card.quote_area'));
    return;
  }
  if (quote.type === undefined || quote.type === 0) {
    // 0 or omitted means the quote block has no click target.
  } else if (quote.type === 1) {
    checkUrl(quote.url, 'template_card.quote_area.url', errors);
  } else if (quote.type === 2) {
    checkString(quote.appid, 'template_card.quote_area.appid', errors);
    checkString(quote.pagepath, 'template_card.quote_area.pagepath', errors, { required: false });
  } else {
    errors.push(error('E_QUOTE_TYPE', 'template_card.quote_area.type must be 0, 1, or 2', 'template_card.quote_area.type'));
    return;
  }
  if (quote.title !== undefined) checkCharLimit(quote.title, 26, 'template_card.quote_area.title', errors, warnings);
  if (!checkString(quote.quote_text, 'template_card.quote_area.quote_text', errors)) return;
  checkCharLimit(quote.quote_text, 500, 'template_card.quote_area.quote_text', errors, warnings);
}

function checkHorizontalList(list, errors, warnings) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(error('E_HORIZONTAL', 'template_card.horizontal_content_list must be an array', 'template_card.horizontal_content_list'));
    return;
  }
  if (list.length > HORIZONTAL_LIMIT) {
    errors.push(
      error('E_HORIZONTAL_COUNT', `template_card.horizontal_content_list supports at most ${HORIZONTAL_LIMIT} rows`, 'template_card.horizontal_content_list'),
    );
  }
  list.forEach((item, index) => {
    const path = `template_card.horizontal_content_list[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(error('E_HORIZONTAL_ITEM', `${path} must be an object`, path));
      return;
    }
    if (checkString(item.keyname, `${path}.keyname`, errors)) {
      checkCharLimit(item.keyname, 5, `${path}.keyname`, errors, warnings);
    }
    if (checkString(item.value, `${path}.value`, errors, { required: false })) {
      checkCharLimit(item.value, 26, `${path}.value`, errors, warnings);
    }
    if (item.type === undefined) {
      // Plain "keyname + value" rows are valid; WeCom leaves horizontal_content_list.type optional.
    } else if (item.type === 1) checkUrl(item.url, `${path}.url`, errors);
    else if (item.type === 2) checkString(item.media_id, `${path}.media_id`, errors);
    else if (item.type === 3) checkString(item.userid, `${path}.userid`, errors);
    else errors.push(error('E_HORIZONTAL_TYPE', `${path}.type must be 1, 2, or 3 when set`, `${path}.type`));
  });
}

function checkJumpList(list, errors, warnings) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(error('E_JUMP', 'template_card.jump_list must be an array', 'template_card.jump_list'));
    return;
  }
  if (list.length > JUMP_LIMIT) {
    errors.push(
      error('E_JUMP_COUNT', `template_card.jump_list supports at most ${JUMP_LIMIT} items`, 'template_card.jump_list'),
    );
  }
  list.forEach((item, index) => {
    const path = `template_card.jump_list[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(error('E_JUMP_ITEM', `${path} must be an object`, path));
      return;
    }
    if (checkString(item.title, `${path}.title`, errors)) {
      checkCharLimit(item.title, 13, `${path}.title`, errors, warnings);
    }
    if (item.type === undefined || item.type === 0) {
      // 0 or omitted means the row is not a link; title alone is valid.
    } else if (item.type === 1) checkUrl(item.url, `${path}.url`, errors);
    else if (item.type === 2) {
      checkString(item.appid, `${path}.appid`, errors);
      checkString(item.pagepath, `${path}.pagepath`, errors, { required: false });
    } else errors.push(error('E_JUMP_TYPE', `${path}.type must be 0, 1, or 2`, `${path}.type`));
  });
}

function checkImageTextArea(area, errors, warnings) {
  if (area === undefined) return;
  if (!isPlainObject(area)) {
    errors.push(error('E_IMAGE_TEXT_AREA', 'template_card.image_text_area must be an object', 'template_card.image_text_area'));
    return;
  }
  if (area.type !== 1 && area.type !== 2) {
    errors.push(error('E_IMAGE_TEXT_AREA_TYPE', 'template_card.image_text_area.type must be 1 or 2', 'template_card.image_text_area.type'));
    return;
  }
  if (area.type === 1) checkUrl(area.url, 'template_card.image_text_area.url', errors);
  else {
    checkString(area.appid, 'template_card.image_text_area.appid', errors);
    checkString(area.pagepath, 'template_card.image_text_area.pagepath', errors);
  }
  checkUrl(area.image_url, 'template_card.image_text_area.image_url', errors);
  if (area.title !== undefined) checkCharLimit(area.title, 26, 'template_card.image_text_area.title', errors, warnings);
  if (area.desc !== undefined) checkCharLimit(area.desc, 112, 'template_card.image_text_area.desc', errors, warnings);
}

function checkVerticalList(list, errors, warnings) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(error('E_VERTICAL', 'template_card.vertical_content_list must be an array', 'template_card.vertical_content_list'));
    return;
  }
  if (list.length > 4) {
    errors.push(error('E_VERTICAL_COUNT', 'template_card.vertical_content_list supports at most 4 items', 'template_card.vertical_content_list'));
  }
  list.forEach((item, index) => {
    const path = `template_card.vertical_content_list[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(error('E_VERTICAL_ITEM', `${path} must be an object`, path));
      return;
    }
    if (checkString(item.title, `${path}.title`, errors)) {
      checkCharLimit(item.title, 26, `${path}.title`, errors, warnings);
    }
    if (item.desc !== undefined) checkCharLimit(item.desc, 112, `${path}.desc`, errors, warnings);
  });
}

function validateTemplateCard(message, errors, warnings) {
  const card = message.template_card;
  if (!isPlainObject(card)) {
    errors.push(error('E_BODY', 'template_card body must be an object', 'template_card'));
    return;
  }
  if (!CARD_TYPES.has(card.card_type)) {
    errors.push(
      error('E_CARD_TYPE', 'template_card.card_type must be text_notice or news_notice', 'template_card.card_type'),
    );
    return;
  }

  checkSource(card.source, errors, warnings);
  checkTitleAndDesc(card, errors, warnings);
  checkQuoteArea(card.quote_area, errors, warnings);
  checkHorizontalList(card.horizontal_content_list, errors, warnings);
  checkJumpList(card.jump_list, errors, warnings);
  checkImageTextArea(card.image_text_area, errors, warnings);
  checkVerticalList(card.vertical_content_list, errors, warnings);

  if (card.card_action === undefined) {
    errors.push(error('E_CARD_ACTION', 'template_card.card_action is required', 'template_card.card_action'));
  } else {
    checkAction(card.card_action, 'template_card.card_action', errors);
  }

  if (card.card_type === 'text_notice') {
    const title = card.main_title?.title;
    const hasTitle = isNonEmptyString(title);
    const hasSubtitle = isNonEmptyString(card.sub_title_text);
    if (!hasTitle && !hasSubtitle) {
      errors.push(
        error(
          'E_CARD_CONTENT',
          'text_notice requires main_title.title or sub_title_text',
          'template_card.main_title.title',
          'Set a title or sub_title_text.',
        ),
      );
    }
  }

  if (card.card_type === 'news_notice') {
    if (!isPlainObject(card.main_title) || !isNonEmptyString(card.main_title.title)) {
      errors.push(error('E_CARD_CONTENT', 'news_notice requires main_title.title', 'template_card.main_title.title'));
    }
    if (!isPlainObject(card.card_image)) {
      errors.push(error('E_CARD_IMAGE', 'news_notice requires card_image.url', 'template_card.card_image'));
    } else {
      checkUrl(card.card_image.url, 'template_card.card_image.url', errors);
      if (card.card_image.aspect_ratio !== undefined) {
        const ratio = card.card_image.aspect_ratio;
        if (typeof ratio !== 'number' || !(ratio > 1.3 && ratio < 2.25)) {
          errors.push(
            error(
              'E_CARD_IMAGE_RATIO',
              'template_card.card_image.aspect_ratio must be a number between 1.3 and 2.25 (exclusive)',
              'template_card.card_image.aspect_ratio',
            ),
          );
        }
      }
    }
  }
}

export function validateMessage(message, { warnings: initialWarnings = [] } = {}) {
  const errors = [];
  const warnings = [...initialWarnings];
  if (!isPlainObject(message)) {
    errors.push(error('E_MESSAGE', 'message must be an object', 'message'));
  } else if (!isPlainObject(message[message.msgtype])) {
    errors.push(error('E_MESSAGE_BODY', `message.${message.msgtype ?? '?'} body is required`, message.msgtype ?? 'message'));
  } else {
    switch (message.msgtype) {
      case 'text':
        validateText(message, errors, warnings);
        break;
      case 'markdown':
      case 'markdown_v2':
        validateMarkdown(message, errors);
        break;
      case 'image':
        validateImage(message, errors);
        break;
      case 'news':
        validateNews(message, errors, warnings);
        break;
      case 'file':
      case 'voice':
        validateMedia(message, errors);
        break;
      case 'template_card':
        validateTemplateCard(message, errors, warnings);
        break;
      default:
        errors.push(error('E_MSG_TYPE', `Unsupported message type "${message.msgtype}"`, 'msgtype'));
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidMessage(message, { warnings } = {}) {
  const result = validateMessage(message, { warnings });
  if (!result.ok) {
    throw new ValidationError(
      `Message validation failed with ${result.errors.length} error(s)`,
      [...result.errors, ...result.warnings],
    );
  }
  return result;
}
