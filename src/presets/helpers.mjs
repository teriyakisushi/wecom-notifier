import { ConfigError } from '../errors.mjs';
import { fitChars, isHttpUrl, oneLine } from '../util.mjs';

export function fitTitle(value, max = 26) {
  return fitChars(oneLine(value), max);
}

export function fitText(value, max) {
  return fitChars(String(value ?? ''), max);
}

export function fitBlock(value, max) {
  return fitChars(String(value ?? '').trim(), max);
}

export function requireHttpUrl(value, path, fallback) {
  const url = value || fallback;
  if (!isHttpUrl(url)) {
    throw new ConfigError(`A valid http(s) URL is required for ${path}`, {
      code: 'E_URL_REQUIRED',
      path,
      hint: 'Set link-url, or use a GitHub event that provides a detail URL.',
    });
  }
  return url;
}

export function makeSource({ desc = 'GitHub', color = 0, icon } = {}) {
  const source = {
    desc: fitChars(oneLine(desc || 'GitHub'), 13),
    desc_color: Number(color) || 0,
  };
  if (icon && isHttpUrl(icon)) source.icon_url = icon;
  return source;
}

export function makeAction(url) {
  return { type: 1, url };
}

export function makeJumpList(items) {
  return items
    .filter(Boolean)
    .filter((item) => item.title && (item.url || (item.appid && item.pagepath)))
    .slice(0, 3)
    .map((item) => {
      const type = Number(item.type) || (item.appid && item.pagepath ? 2 : 1);
      const out = {
        type,
        title: fitChars(oneLine(item.title), 13),
      };
      if (type === 1) out.url = item.url;
      if (type === 2) {
        out.appid = item.appid;
        out.pagepath = item.pagepath;
      }
      return out;
    });
}

export function makeHorizontalList(items) {
  return items
    .filter(Boolean)
    .filter((item) => item.keyname && item.value !== undefined && item.value !== null && String(item.value) !== '')
    .slice(0, 6)
    .map((item) => {
      const out = {
        keyname: fitChars(oneLine(item.keyname), 5),
        value: fitChars(oneLine(item.value), 26),
      };
      const type = Number(item.type) || (item.userid ? 3 : item.media_id ? 2 : item.url ? 1 : 0);
      if (type) out.type = type;
      if (type === 1 && item.url) out.url = item.url;
      if (type === 2 && item.media_id) out.media_id = item.media_id;
      if (type === 3 && item.userid) out.userid = item.userid;
      return out;
    });
}

export function makeTextNotice({
  source,
  title,
  desc,
  emphasis,
  quote,
  subTitle,
  horizontal,
  jump,
  action,
}) {
  const card = {
    card_type: 'text_notice',
    source,
    main_title: { title, desc },
    card_action: action,
  };
  if (emphasis) card.emphasis_content = emphasis;
  if (quote) card.quote_area = quote;
  if (subTitle) card.sub_title_text = subTitle;
  if (horizontal?.length) card.horizontal_content_list = horizontal;
  if (jump?.length) card.jump_list = jump;
  return { msgtype: 'template_card', template_card: card };
}

export function makeNewsNotice({
  source,
  title,
  desc,
  imageUrl,
  quote,
  imageTextArea,
  vertical,
  horizontal,
  jump,
  action,
  aspectRatio = 1.3,
}) {
  const card = {
    card_type: 'news_notice',
    source,
    main_title: { title, desc },
    card_image: { url: imageUrl, aspect_ratio: aspectRatio },
    card_action: action,
  };
  if (quote) card.quote_area = quote;
  if (imageTextArea) card.image_text_area = imageTextArea;
  if (vertical?.length) card.vertical_content_list = vertical;
  if (horizontal?.length) card.horizontal_content_list = horizontal;
  if (jump?.length) card.jump_list = jump;
  return { msgtype: 'template_card', template_card: card };
}

export function quoteArea(text, max = 500) {
  const quote = oneLine(text);
  if (!quote) return undefined;
  return { quote_text: fitChars(quote, max) };
}

export function infoItem(keyname, value, extra = {}) {
  return { keyname, value, ...extra };
}

export function linkItem(title, url) {
  return { title, url };
}

function parseJsonArray(text, label) {
  if (!/^\s*[[{]/u.test(text)) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${label} looks like JSON but could not be parsed`, {
      code: 'E_CARD_INPUT',
      path: label,
      hint: 'Use valid JSON, or use one "key: value" / "title | url" line per item.',
      cause: error,
    });
  }
  if (parsed && !Array.isArray(parsed)) {
    throw new ConfigError(`${label} JSON must be an array`, { code: 'E_CARD_INPUT', path: label });
  }
  return parsed;
}

export function parseInfoInput(value, { max = 6 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  let items = parseJsonArray(text, 'info');
  if (!items) {
    items = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(':');
        if (index <= 0) {
          throw new ConfigError(`Invalid info line: ${line}`, {
            code: 'E_CARD_INPUT',
            path: 'info',
            hint: 'Use "Label: value" per line, or a JSON array of {keyname,value}.',
          });
        }
        return { keyname: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
      });
  }
  if (items.length > max) {
    throw new ConfigError(`info supports at most ${max} rows`, {
      code: 'E_CARD_INPUT',
      path: 'info',
      hint: 'Remove rows or use a link list instead.',
    });
  }
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new ConfigError(`info[${index}] must be an object`, { code: 'E_CARD_INPUT', path: 'info' });
    }
    const keyname = item.keyname;
    const valueText = item.value;
    if (keyname === undefined || String(keyname).trim() === '') {
      throw new ConfigError(`info[${index}].keyname is required`, { code: 'E_CARD_INPUT', path: 'info' });
    }
    if (valueText === undefined) {
      throw new ConfigError(`info[${index}].value is required`, { code: 'E_CARD_INPUT', path: 'info' });
    }
    const out = { keyname: String(keyname), value: String(valueText) };
    if (item.type !== undefined) out.type = Number(item.type);
    if (item.url !== undefined) out.url = String(item.url);
    if (item.media_id !== undefined) out.media_id = String(item.media_id);
    if (item.userid !== undefined) out.userid = String(item.userid);
    return out;
  });
}

export function parseLinksInput(value, { max = 3 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  let items = parseJsonArray(text, 'links');
  if (!items) {
    items = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('|');
        if (index <= 0) {
          throw new ConfigError(`Invalid links line: ${line}`, {
            code: 'E_CARD_INPUT',
            path: 'links',
            hint: 'Use "Title | https://url" per line, or a JSON array of {title,url}.',
          });
        }
        return { title: line.slice(0, index).trim(), url: line.slice(index + 1).trim() };
      });
  }
  if (items.length > max) {
    throw new ConfigError(`links supports at most ${max} rows`, {
      code: 'E_CARD_INPUT',
      path: 'links',
      hint: 'WeCom jump_list has a hard limit of 3.',
    });
  }
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new ConfigError(`links[${index}] must be an object`, { code: 'E_CARD_INPUT', path: 'links' });
    }
    if (item.title === undefined || String(item.title).trim() === '') {
      throw new ConfigError(`links[${index}].title is required`, { code: 'E_CARD_INPUT', path: 'links' });
    }
    const out = { title: String(item.title) };
    if (item.type !== undefined) out.type = Number(item.type);
    if (item.url !== undefined) out.url = String(item.url);
    if (item.appid !== undefined) out.appid = String(item.appid);
    if (item.pagepath !== undefined) out.pagepath = String(item.pagepath);
    return out;
  });
}
