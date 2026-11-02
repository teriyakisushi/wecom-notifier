import crypto from 'node:crypto';

import { ConfigError } from '../errors.mjs';
import { clone, isPlainObject, toInteger } from '../util.mjs';

const TYPE_ALIASES = new Map([
  ['text', 'text'],
  ['markdown', 'markdown'],
  ['markdown_v2', 'markdown_v2'],
  ['markdownv2', 'markdown_v2'],
  ['news', 'news'],
  ['image', 'image'],
  ['file', 'file'],
  ['voice', 'voice'],
  ['template_card', 'template_card'],
  ['card', 'template_card'],
  ['card_text', 'text_notice'],
  ['text_notice', 'text_notice'],
  ['card_news', 'news_notice'],
  ['news_notice', 'news_notice'],
]);

function warning(code, message, path) {
  return { level: 'warning', code, message, path };
}

function asString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function normalizeSource(source) {
  if (!isPlainObject(source)) return source;
  const out = { ...source };
  if (out.desc !== undefined) out.desc = asString(out.desc);
  if (out.desc_color !== undefined) out.desc_color = toInteger(out.desc_color, out.desc_color);
  if (out.icon_url !== undefined) out.icon_url = asString(out.icon_url);
  return out;
}

function normalizeAction(action) {
  if (!isPlainObject(action)) return action;
  const out = { ...action };
  if (out.type !== undefined) out.type = toInteger(out.type, out.type);
  if (out.url !== undefined) out.url = asString(out.url);
  if (out.appid !== undefined) out.appid = asString(out.appid);
  if (out.pagepath !== undefined) out.pagepath = asString(out.pagepath);
  return out;
}

function normalizeHorizontalList(list) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!isPlainObject(item)) return item;
    const out = { ...item };
    if (out.type === undefined) {
      if (out.userid) out.type = 3;
      else if (out.media_id) out.type = 2;
      else if (out.url) out.type = 1;
    }
    if (out.type !== undefined) out.type = toInteger(out.type, out.type);
    if (out.keyname !== undefined) out.keyname = asString(out.keyname);
    if (out.value !== undefined) out.value = asString(out.value);
    if (out.url !== undefined) out.url = asString(out.url);
    if (out.media_id !== undefined) out.media_id = asString(out.media_id);
    if (out.userid !== undefined) out.userid = asString(out.userid);
    return out;
  });
}

function normalizeJumpList(list) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!isPlainObject(item)) return item;
    const out = { ...item };
    if (out.type === undefined) {
      if (out.appid || out.pagepath) out.type = 2;
      else if (out.url) out.type = 1;
    }
    if (out.type !== undefined) out.type = toInteger(out.type, out.type);
    if (out.title !== undefined) out.title = asString(out.title);
    if (out.url !== undefined) out.url = asString(out.url);
    if (out.appid !== undefined) out.appid = asString(out.appid);
    if (out.pagepath !== undefined) out.pagepath = asString(out.pagepath);
    return out;
  });
}

function normalizeQuoteArea(quote) {
  if (!isPlainObject(quote)) return quote;
  const out = { ...quote };
  if (out.type === undefined && out.url) out.type = 1;
  if (out.type !== undefined) out.type = toInteger(out.type, out.type);
  for (const key of ['url', 'appid', 'pagepath', 'title', 'quote_text']) {
    if (out[key] !== undefined) out[key] = asString(out[key]);
  }
  return out;
}

function normalizeImageTextArea(area) {
  if (!isPlainObject(area)) return area;
  const out = { ...area };
  if (out.type === undefined) out.type = 1;
  if (out.type !== undefined) out.type = toInteger(out.type, out.type);
  for (const key of ['url', 'appid', 'pagepath', 'title', 'desc', 'image_url']) {
    if (out[key] !== undefined) out[key] = asString(out[key]);
  }
  return out;
}

function normalizeVerticalList(list) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!isPlainObject(item)) return item;
    const out = { ...item };
    if (out.title !== undefined) out.title = asString(out.title);
    if (out.desc !== undefined) out.desc = asString(out.desc);
    return out;
  });
}

function normalizeTemplateCard(body, requestedType) {
  const card = clone(body);
  delete card.msgtype;
  delete card.template_card;
  delete card.card;
  const cardType = card.card_type || requestedType;
  if (cardType !== 'text_notice' && cardType !== 'news_notice') {
    throw new ConfigError(`Unsupported template_card.card_type "${cardType}"`, {
      code: 'E_CARD_TYPE',
      path: 'template_card.card_type',
      hint: 'Group webhooks support only text_notice and news_notice.',
    });
  }
  card.card_type = cardType;
  if (card.source !== undefined) card.source = normalizeSource(card.source);
  if (isPlainObject(card.main_title)) {
    card.main_title = {
      ...card.main_title,
      title: asString(card.main_title.title),
      ...(card.main_title.desc === undefined ? {} : { desc: asString(card.main_title.desc) }),
    };
  }
  if (isPlainObject(card.emphasis_content)) {
    card.emphasis_content = {
      ...card.emphasis_content,
      title: asString(card.emphasis_content.title),
      ...(card.emphasis_content.desc === undefined ? {} : { desc: asString(card.emphasis_content.desc) }),
    };
  }
  if (card.quote_area !== undefined) card.quote_area = normalizeQuoteArea(card.quote_area);
  if (card.sub_title_text !== undefined) card.sub_title_text = asString(card.sub_title_text);
  if (card.horizontal_content_list !== undefined) {
    card.horizontal_content_list = normalizeHorizontalList(card.horizontal_content_list);
  }
  if (card.jump_list !== undefined) card.jump_list = normalizeJumpList(card.jump_list);
  if (card.card_action !== undefined) card.card_action = normalizeAction(card.card_action);
  if (isPlainObject(card.card_image)) {
    card.card_image = { ...card.card_image };
    if (card.card_image.url !== undefined) card.card_image.url = asString(card.card_image.url);
    if (card.card_image.aspect_ratio !== undefined) {
      const ratio = Number(card.card_image.aspect_ratio);
      card.card_image.aspect_ratio = Number.isFinite(ratio) ? ratio : card.card_image.aspect_ratio;
    }
  }
  if (card.image_text_area !== undefined) card.image_text_area = normalizeImageTextArea(card.image_text_area);
  if (card.vertical_content_list !== undefined) {
    card.vertical_content_list = normalizeVerticalList(card.vertical_content_list);
  }
  return card;
}

function bodyFrom(raw, keys) {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  return undefined;
}

function normalizeTextLike(type, body) {
  const payload = typeof body === 'string' ? { content: body } : isPlainObject(body) ? clone(body) : {};
  delete payload.msgtype;
  payload.content = asString(payload.content);
  if (Array.isArray(payload.mentioned_list)) payload.mentioned_list = payload.mentioned_list.map(String);
  if (Array.isArray(payload.mentioned_mobile_list)) {
    payload.mentioned_mobile_list = payload.mentioned_mobile_list.map(String);
  }
  return { msgtype: type, [type]: payload };
}

function normalizeNews(body) {
  const payload = isPlainObject(body) ? clone(body) : {};
  delete payload.msgtype;
  if (isPlainObject(payload.articles)) payload.articles = [payload.articles];
  if (!Array.isArray(payload.articles)) payload.articles = [];
  payload.articles = payload.articles.map((article) => {
    const out = isPlainObject(article) ? { ...article } : {};
    for (const key of ['title', 'description', 'url', 'picurl']) {
      if (out[key] !== undefined) out[key] = asString(out[key]);
    }
    return out;
  });
  return { msgtype: 'news', news: payload };
}

function stripDataUrl(value) {
  const text = asString(value).trim();
  const match = /^data:[^;]+;base64,(.*)$/isu.exec(text);
  return match ? match[1] : text;
}

function normalizeImage(body, warnings) {
  let payload;
  if (typeof body === 'string') payload = { base64: body };
  else payload = isPlainObject(body) ? clone(body) : {};
  const base64 = stripDataUrl(payload.base64).replace(/\s+/gu, '');
  if (!base64) {
    throw new ConfigError('image.base64 is required', {
      code: 'E_IMAGE_BASE64',
      path: 'image.base64',
      hint: 'Use a base64 string, a data: URL, or omit the image message.',
    });
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) {
    throw new ConfigError('image.base64 is not valid base64', {
      code: 'E_IMAGE_BASE64',
      path: 'image.base64',
    });
  }
  const md5 = crypto.createHash('md5').update(bytes).digest('hex');
  const supplied = asString(payload.md5).trim().toLowerCase();
  if (supplied && supplied !== md5) {
    warnings.push(
      warning(
        'W_IMAGE_MD5',
        'image.md5 does not match the base64 payload; the computed MD5 will be used',
        'image.md5',
      ),
    );
  }
  return { msgtype: 'image', image: { base64, md5 } };
}

function normalizeMedia(type, body) {
  const payload = typeof body === 'string' ? { media_id: body } : isPlainObject(body) ? clone(body) : {};
  delete payload.msgtype;
  payload.media_id = asString(payload.media_id);
  return { msgtype: type, [type]: payload };
}

function resolveType(raw) {
  if (!isPlainObject(raw)) {
    throw new ConfigError('The message payload must be a mapping/object', {
      code: 'E_PAYLOAD',
      path: 'payload',
    });
  }
  const requested = asString(raw.msgtype).trim().toLowerCase();
  if (!requested) {
    if (isPlainObject(raw.template_card) || isPlainObject(raw.card)) return 'template_card';
    if (isPlainObject(raw.text)) return 'text';
    if (isPlainObject(raw.markdown)) return 'markdown';
    if (isPlainObject(raw.markdown_v2)) return 'markdown_v2';
    if (isPlainObject(raw.news)) return 'news';
    if (isPlainObject(raw.image)) return 'image';
    if (isPlainObject(raw.file)) return 'file';
    if (isPlainObject(raw.voice)) return 'voice';
    if (typeof raw.content === 'string') return 'text';
    return undefined;
  }
  return TYPE_ALIASES.get(requested);
}

export function normalizeMessage(raw) {
  const type = resolveType(raw);
  if (!type) {
    throw new ConfigError(`Unsupported message type "${asString(raw.msgtype) || '(missing)'}"`, {
      code: 'E_MSG_TYPE',
      path: 'msgtype',
      hint: 'Use text, markdown, markdown_v2, image, news, file, voice, or template_card.',
    });
  }

  const warnings = [];
  if (type === 'text_notice' || type === 'news_notice') {
    const body = bodyFrom(raw, [type, 'card_text', 'card_news', 'template_card', 'card']);
    return {
      message: {
        msgtype: 'template_card',
        template_card: normalizeTemplateCard(isPlainObject(body) ? body : raw, type),
      },
      warnings,
    };
  }

  if (type === 'template_card') {
    let body = bodyFrom(raw, ['template_card', 'card']);
    if (!isPlainObject(body)) {
      body = raw.card_type !== undefined ? raw : {};
    }
    return {
      message: {
        msgtype: 'template_card',
        template_card: normalizeTemplateCard(body, raw.card_type),
      },
      warnings,
    };
  }

  const body = bodyFrom(raw, [type, type.replace(/_v2$/u, '')]);
  switch (type) {
    case 'text':
    case 'markdown':
    case 'markdown_v2': {
      const payload = body === undefined && raw.content !== undefined ? raw : body;
      return { message: normalizeTextLike(type, payload), warnings };
    }
    case 'news': {
      const payload = body === undefined && raw.articles !== undefined ? raw : body;
      return { message: normalizeNews(payload), warnings };
    }
    case 'image': {
      const payload =
        body === undefined && (raw.base64 !== undefined || raw.md5 !== undefined) ? raw : body;
      return { message: normalizeImage(payload, warnings), warnings };
    }
    case 'file':
    case 'voice': {
      const payload = body === undefined && raw.media_id !== undefined ? raw : body;
      return { message: normalizeMedia(type, payload), warnings };
    }
    default:
      throw new ConfigError(`Unsupported message type "${type}"`, {
        code: 'E_MSG_TYPE',
        path: 'msgtype',
      });
  }
}

export { normalizeTemplateCard, normalizeNews, normalizeImage };
