# 企业微信消息格式

本文是实现所依据的企业微信群机器人（Webhook）约束，以及和本 Action 行为相关的差异。完整文档见 [企业微信开发者文档 91770](https://developer.work.weixin.qq.com/document/path/91770)。

## 1. 发送接口

```http
POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY
Content-Type: application/json
```

```json
{
  "msgtype": "markdown",
  "markdown": {
    "content": "**部署完成**\n> 版本 v1.2.3"
  }
}
```

- 成功：HTTP 2xx 且 `errcode` 为 0。
- 失败：`errcode` 非 0，`errmsg` 说明原因。
- 每个 webhook 限制 **20 条/分钟**；触发 `45009` 时 Action 会退避重试。
- webhook URL 等同凭证，不要写进模板、日志或公开仓库；请用 GitHub Secrets。

`webhook` 输入可以只传 `key`，Action 拼接默认 `https://qyapi.weixin.qq.com`；完整 URL 必须带 `key` 参数。

## 2. 支持的消息类型

| `msgtype` | 本 Action | 说明 |
| --- | --- | --- |
| `text` | ✅ | 纯文本，2048 字节以内 |
| `markdown` | ✅ | Markdown，4096 字节以内 |
| `markdown_v2` | ✅ | 新版 Markdown，4096 字节以内 |
| `image` | ✅ | base64 + md5，≤2MB |
| `news` | ✅ | 图文，1–8 条 |
| `file` | ✅（仅透传） | 需要 `media_id`；Action 不上传文件 |
| `voice` | ✅（仅透传） | 需要 `media_id`；Action 不上传语音 |
| `template_card` | ✅ | `text_notice` / `news_notice` |

消息对象统一是 `{ "msgtype": "...", "<类型>": { ... } }`。`template_card` 用 `template_card` 子对象，并在其中写 `card_type`。

## 3. 文本

```json
{
  "msgtype": "text",
  "text": {
    "content": "部署完成：v1.2.3\n耗时 2m13s",
    "mentioned_list": ["zhangsan", "@all"],
    "mentioned_mobile_list": ["13800001111", "@all"]
  }
}
```

- `content` ≤ **2048 字节**（UTF-8）；Action 的 `auto-truncate` 会按字节截断。
- `mentioned_list` 是 userid 列表；`mentioned_mobile_list` 是手机号列表；`@all` 表示所有人。
- 纯文本里也可以用 `<@userid>` 提及，但需要客户端支持。
- 手机号必须和企业微信成员匹配，否则可能不生效。

## 4. Markdown / Markdown V2

### markdown

```json
{
  "msgtype": "markdown",
  "markdown": {
    "content": "### 部署完成\n**版本**：v1.2.3\n> 环境：production\n[查看运行](https://github.com/...)"
  }
}
```

- `content` ≤ **4096 字节**。
- 支持 1–6 级标题、`**粗体**`、`` `[链接](https://example.com)` ``、`` `行内代码` ``、`>` 引用、`<font color="info|comment|warning">...</font>`。
- 支持 `<@userid>` 提及（前提是机器人可见该成员）。
- 不支持表格、图片、多级列表等复杂语法。

### markdown_v2

```json
{
  "msgtype": "markdown_v2",
  "markdown_v2": {
    "content": "## 发布说明\n- 修复 A\n- 新增 B\n\n![截图](https://example.com/a.png)"
  }
}
```

- `content` ≤ **4096 字节**。
- 不支持字体颜色和 `@` 提及。
- 支持 *斜体*、列表、多级引用、`![]()` 图片、`---` 分割线、代码块、表格。
- 客户端版本低于 4.1.36（安卓低于 4.1.38）会退化为纯文本显示，排版不可控。
- 链接/图片 URL 必须是客户端可访问的地址。

## 5. 图片

```json
{
  "msgtype": "image",
  "image": {
    "base64": "iVBORw0KGgo...",
    "md5": "d41d8cd98f00b204e9800998ecf8427e"
  }
}
```

- base64 字符串本身不超过 **2MB**；只支持 JPG/PNG。
- `md5` 是**原始图片字节**的 32 位小写 MD5，不是 base64 文本的 MD5。
- Action 接收 base64 或 `data:image/...;base64,...`，会去掉 data URL 前缀和空白；没有 md5 时自动计算。
- 如果提供了错误的 md5，会给 `W_IMAGE_MD5` warning 并以计算值为准（避免把明显错误发出去）。
- Action 不帮你上传本地文件；图片需要是 base64 文本或由 builder 生成。

## 6. 图文 news

```json
{
  "msgtype": "news",
  "news": {
    "articles": [
      {
        "title": "发布 v1.2.3",
        "description": "修复了若干问题",
        "url": "https://github.com/teriyakiushi/wecom-notifier/releases/tag/v1.2.3",
        "picurl": "https://example.com/cover.png"
      }
    ]
  }
}
```

- `articles` **1–8 条**；超过 8 条报错（`45008` 也可能由服务端返回）。
- `title` ≤ **128 字节**；`description` ≤ **512 字节**；超长时企业微信会自动截断，Action 在 `auto-truncate: true` 时也会按字节截断并给 warning。
- `url` 必填；`picurl` 选填，必须是 JPG/PNG 公网地址。
- 图片建议：大图 1068×455，小图 150×150。

## 7. 文件 / 语音

```json
{ "msgtype": "file", "file": { "media_id": "MEDIA_ID" } }
{ "msgtype": "voice", "voice": { "media_id": "MEDIA_ID" } }
```

- 需要先调用 `upload_media` 得到 `media_id`：

  ```http
  POST https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=KEY&type=file
  Content-Type: multipart/form-data
  ```

  表单字段名 `media`，包含 `filename`。
- `media_id` 3 天有效，且只对上传它的 webhook 有效。
- 普通文件 >5 字节且 ≤20MB；语音仅 AMR，≤2MB、≤60 秒。
- **本 Action 不执行上传**，只把 `media_id` 原样发送；上传由你自行完成。

## 8. 模板卡片 template_card

Webhook 只支持 `text_notice` 和 `news_notice`，不支持按钮交互卡片。

### 公共结构

```json
{
  "msgtype": "template_card",
  "template_card": {
    "card_type": "text_notice",
    "source": {
      "icon_url": "https://example.com/icon.png",
      "desc": "GitHub",
      "desc_color": 0
    },
    "main_title": { "title": "部署完成", "desc": "production" },
    "sub_title_text": "版本 v1.2.3",
    "horizontal_content_list": [
      { "keyname": "版本", "value": "v1.2.3" },
      { "keyname": "分支", "value": "main" }
    ],
    "jump_list": [
      { "type": 1, "title": "查看运行", "url": "https://github.com/..." }
    ],
    "card_action": { "type": 1, "url": "https://github.com/..." }
  }
}
```

- `source.desc` 建议 ≤13 字；`desc_color`：0 灰、1 黑、2 红、3 绿。
- 推荐长度是“建议”，不是硬限制；超过给 warning，不静默裁剪（预设除外）。
- `horizontal_content_list` 最多 **6** 行；`jump_list` 最多 **3** 条；`vertical_content_list` 最多 **4** 条。

### text_notice

- `main_title.title` 与 `sub_title_text` 至少有一个；`card_action` 必填。
- `main_title.title` 建议 ≤26 字；`main_title.desc` 建议 ≤30 字。
- `sub_title_text` 建议 ≤112 字。
- `emphasis_content`：`title` 建议 ≤10 字，`desc` 建议 ≤15 字；建议不要与 `quote_area` 同时使用（可能显示不下）。
- `quote_area`：`type` 可为 0/1/2（0 或不填表示无点击）；`type: 1` 需要 `url`；`type: 2` 需要 `appid`，`pagepath` 选填。
- `horizontal_content_list`：`keyname` 必填，`value` 选填；`type` 不填表示纯文本；`type: 1` 需要 `url`，`type: 2` 需要 `media_id`，`type: 3` 需要 `userid`。
- `jump_list`：`title` 必填；`type` 不填或 0 表示不是链接；`type: 1` 需要 `url`；`type: 2` 需要 `appid`，`pagepath` 选填。
- `card_action`：`type: 1` 需要 `url`；`type: 2` 需要 `appid`、`pagepath`。

### news_notice

```json
{
  "msgtype": "template_card",
  "template_card": {
    "card_type": "news_notice",
    "main_title": { "title": "发布 v1.2.3" },
    "card_image": { "url": "https://example.com/cover.png", "aspect_ratio": 1.7 },
    "image_text_area": {
      "type": 1,
      "url": "https://github.com/...",
      "title": "发布说明",
      "desc": "修复了若干问题",
      "image_url": "https://example.com/cover.png"
    },
    "vertical_content_list": [
      { "title": "版本", "desc": "v1.2.3" }
    ],
    "card_action": { "type": 1, "url": "https://github.com/..." }
  }
}
```

- `main_title.title` 必填；`card_image.url` 必填。
- `card_image.aspect_ratio`：**1.3 < ratio < 2.25**；不填默认 1.3。
- `image_text_area.image_url` 必填；`type: 1` 需要 `url`，`type: 2` 需要 `appid`/`pagepath`；`pagepath` 选填。
- `vertical_content_list`：`title` 建议 ≤26 字，`desc` 建议 ≤112 字；最多 4 条。
- `quote_area`、`horizontal_content_list`、`jump_list`、`card_action` 规则同 `text_notice`。

## 9. 错误码与重试

| errcode | 含义 | Action 行为 |
| --- | --- | --- |
| 0 | 成功 | 结束 |
| 93000 | webhook URL 不合法，或机器人已被移出群 | 不重试，报错 |
| 93001 | 当前群聊不允许推送 | 不重试，报错 |
| 93004 | 消息推送被停用 | 不重试，报错 |
| 93006 | 不合法的群 ID | 不重试，报错 |
| 93008 | 不在群里 | 不重试，报错 |
| 93017 | 请求内容不能为空 | 不重试，报错 |
| 93018 | 图片大小超过限制 | 不重试，报错 |
| 45008 | 图文文章数超限（不能超过 8 条） | 不重试，报错 |
| 45009 | 接口调用超过限制 | **重试**（指数退避，尊重 `Retry-After`） |
| 40058 | 不合法的参数 | 不重试，报错（先看本地校验错误） |

网络错误、超时、HTTP 5xx/429 也会重试；默认重试 2 次，退避 1s、2s、4s…，上限 10s。业务错误（如 93000）不重试，避免重复打扰。

`fail-on-error: true`（默认）会让 step 失败；`false` 只 warning 并 `exit 0`。校验失败绝不发送。

## 10. 与 builder 的关系

`docs/index.html` 是同一套消息结构的可视化构建器：

- 可切换消息类型、填写字段、实时预览；
- 可导出 JSON 或 YAML，直接替换 `.github/wecom-notify/<event>.yml` 的消息体；
- 可导出 `uses:` 步骤片段；
- 会计算图片 MD5、把数字字段写成数值，并在导出前做基础校验。

builder 生成的是“消息体”；模板文件还可以加 `{{ }}`、`$if`、`$each` 和 `overrides`。两者的边界见 [模板](templates.md) 和 [配置](configuration.md)。
