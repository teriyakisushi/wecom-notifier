# 配置

本文说明 Action 的输入、消息来源优先级、模板文件发现规则，以及 `overrides` / `vars` 的合并语义。

## 1. 消息从哪里来

```text
payload（内联）
template（显式文件）
template-dir（按事件自动查找）
preset（auto / 事件名 / text / markdown / card / none）
        │
        ▼
   基础消息
        │  + 配置文件的 overrides
        │  + Action 输入的 overrides
        ▼
   渲染 {{ }} / $if / $each
        │
        ▼
   剪空 → 类型归一 → 截断 → 校验 → 发送
```

优先级从高到低：

1. **`payload` 非空**：直接作为基础消息或配置。此时再设置 `template` 会报 `E_TEMPLATE_CONFLICT`，避免二义性。`payload` 优先于自动目录。
2. **`template` 非空**：读取显式文件，优先于 `template-dir`。文件不存在直接报错，不会静默回落。
3. **`template-dir` 自动查找**：默认 `.github/wecom-notify/`，按当前事件找文件；找不到再看默认文件；都没有则回落预设。`template-dir: ''` 可禁用自动查找。
4. **`preset`**：默认 `auto`；按 `GITHUB_EVENT_NAME` 选择内置预设。未知事件使用 `generic`。
5. 如果模板/配置是包装形态，`extends` 指定基础预设；`extends: auto` 使用当前事件。

> 如果 workflow 里没有 `actions/checkout`，runner 上没有仓库文件，`template-dir` 找不到模板，最终会使用内置预设。这不一定是错误；需要模板文件时请先 checkout。

## 2. 输入总表

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `webhook` | 空 | 企业微信群机器人 Webhook URL，或只传 `key`。非 dry-run 时必填。建议使用 secret。 |
| `preset` | `auto` | `auto` / 事件名 / `text` / `markdown` / `card` / `none`。 |
| `payload` | 空 | 内联 YAML/JSON 消息或配置包装。与 `template` 互斥。 |
| `template` | 空 | 显式模板文件路径（相对 workspace）。优先于 `template-dir`。 |
| `template-dir` | `.github/wecom-notify` | 按事件查找模板的目录；空字符串禁用。 |
| `overrides` | 空 | YAML/JSON 深合并补丁，最后应用。 |
| `vars` | 空 | YAML/JSON 变量对象，模板中通过 `vars.*` 访问；覆盖配置文件里的同名 `vars`。 |
| `title` | 空 | `preset: card` 的卡片主标题；为空时回退到 `repo.full_name`。 |
| `subtitle` | 空 | `preset: card` 的 `main_title.desc`。 |
| `content` | 空 | `preset: card` 的正文：text_notice 用 `sub_title_text`；news_notice 用 `image_text_area.desc`。也用于 `preset: text` / `markdown` 的内容。 |
| `info` | 空 | 卡片键值行，最多 6 行。逐行 `key: value`，或 JSON 数组。 |
| `links` | 空 | 卡片跳转链接，最多 3 条。逐行 `title \| url`，或 JSON 数组。 |
| `link-url` | 空 | 卡片主按钮/点击区域 URL。 |
| `link-title` | `查看详情` | 没有 `links` 但设置了 `link-url` 时，自动生成一条跳转链接的标题。 |
| `image-url` | 空 | 非空时生成 `news_notice` 图文卡片，使用该公网图片作为封面。 |
| `source` | `GitHub` | 卡片来源文字（`source.desc`）。 |
| `source-icon` | 空 | 卡片来源图标 URL；为空时不设置，避免裂图。 |
| `source-color` | `0` | 来源颜色：0 灰、1 黑、2 红、3 绿。 |
| `dry-run` | `false` | 只渲染、校验并输出，不发送。 |
| `fail-on-error` | `true` | 校验或发送失败时是否让 step 失败。 |
| `auto-truncate` | `true` | 自动截断 text/markdown/markdown_v2 的硬字节限制，以及 news 标题/描述。 |
| `timeout` | `10` | 单次 HTTP 请求超时（秒），1–60。 |
| `retries` | `2` | 网络错误、超时、HTTP 5xx/429、WeCom `45009` 的重试次数，0–5。 |
| `api-base` | `https://qyapi.weixin.qq.com` | 当 `webhook` 只传 key 时使用的 API 基址；完整 URL 时忽略。 |
| `debug` | `false` | 输出不含密钥的诊断信息。 |
| `html` | 空 | dry-run 时额外写一份自包含 HTML 预览到该路径（相对 workspace）。 |

### webhook 的两种写法

```yaml
# 完整 URL（推荐）
webhook: ${{ secrets.WECOM_WEBHOOK }}

# 只传 key，Action 自动拼到 api-base
webhook: ${{ secrets.WECOM_KEY }}
```

完整 URL 必须带 `key` 查询参数；否则报 `E_WEBHOOK_KEY`。`api-base` 只影响“只传 key”的情况，方便企业网关或本地测试。

## 3. 输入/输出与 Action 步骤

```yaml
- id: wecom
  uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: card
    title: "部署完成"
    dry-run: "false"

- run: echo '${{ steps.wecom.outputs.msgtype }}'
```

输出：

| 输出 | 说明 |
| --- | --- |
| `msgtype` | 最终消息类型，如 `template_card`、`markdown`。 |
| `payload` | 最终 JSON。超过 64KB 时截断并加标记；完整内容以日志/本地文件为准。 |
| `errcode` | 企业微信返回码；dry-run 或未发送时为空。 |
| `errmsg` | 企业微信返回信息。 |

`payload` 很多行时，GitHub 使用 heredoc 分隔符写入 `GITHUB_OUTPUT`，不会破坏后续输出。

## 4. 一事件一文件

默认目录：`.github/wecom-notify/`。

```text
.github/wecom-notify/
├── wecom-push.yml          # 只处理 push
├── wecom-pull_request.yml  # 只处理 pull_request
├── default.yml            # 可选兜底
```

### 发现规则

对当前事件名（如 `push`）依次查找：

1. 精确匹配：`push.yml`、`push.yaml`；
2. 后缀匹配：`*-push.yml`、`*-push.yaml`，例如 `wecom-push.yml`；
3. 如果 1+2 匹配到多个文件 → `E_TEMPLATE_AMBIGUOUS`，不会猜；
4. 没有事件文件时，使用 `default.yml`、`default.yaml`、`_default.yml` 或 `_default.yaml`（多个默认文件也会报错）；
5. 都没有 → 使用 `preset` / 当前事件预设。

注意：

- 只扫描目录第一层，不递归；跳过以 `.` 开头的文件。
- 只接受 `.yml` / `.yaml`。
- 事件名只允许字母、数字、`_`、`.`、`-`。
- 同一事件保留一个文件即可，不要同时放 `push.yml` 和 `wecom-push.yml`。
- 目录可以是别的路径；用 `template-dir` 指定，路径必须位于 workspace 内。
- 显式 `template` 优先于目录查找；`payload` 又优先于 `template`。

### 两种文档形态

**A. 纯消息**：顶层有 `msgtype`，整个对象就是企业微信消息。

```yaml
# .github/wecom-notify/push.yml
msgtype: template_card
template_card:
  card_type: text_notice
  source:
    desc: "{{ repo.name }}"
  main_title:
    title: "📦 {{ repo.name }}"
  card_action:
    type: 1
    url: "{{ repo.html_url }}"
```

**B. 配置包装**：顶层没有 `msgtype`，只允许 `extends`、`vars`、`overrides`。

```yaml
# .github/wecom-notify/wecom-push.yml
extends: push
vars:
  environment: production
overrides:
  template_card:
    source:
      desc: "{{ vars.environment }}"
      desc_color: 3
```

规则：

- 纯消息不能再包含 `extends` / `vars` / `overrides`。
- 包装文档必须至少有 `extends` 或 `overrides`；只有 `overrides` 时默认 `extends: auto`。
- 包装文档出现其他顶层键 → 报错。
- `extends` 可选值：`auto`、事件名、`generic`、`text`、`markdown`、`card`、`none`。
- `extends: none` 表示从空消息开始，此时必须靠 `overrides` 或 `payload` 产生完整消息。
- 文件最大 5MB；YAML 别名最多 100；路径必须留在 workspace 内。

## 5. vars 与 overrides

### vars

`vars` 是模板的唯一自定义数据入口：

```yaml
vars:
  environment: production
  dashboard: https://example.com/dashboard
```

```yaml
title: "{{ vars.environment }} · {{ repo.name }}"
```

- `vars` 的值不会再次渲染（避免递归），但可以在模板里用 `{{ vars.x }}` 访问。
- 配置文件里的 `vars` 与 Action 输入的 `vars` 合并，**输入优先**。
- `vars` 不会展开为 `process.env`；模板不能读取环境变量。

### overrides

```yaml
overrides:
  template_card:
    source:
      desc: 我的机器人
      desc_color: 3
    main_title:
      title: "📦 {{ repo.name }}"
```

- 对象递归合并；数组整体替换；`null` 删除键；`0` / `false` 保留。
- 配置文件里的 `overrides` 先应用，Action 输入的 `overrides` 后应用（后者优先）。
- `overrides` 里可以写模板表达式、`$if`、`$each`；它们和基础消息一起渲染。
- 深合并禁止 `__proto__`、`constructor`、`prototype`，防止原型污染。

## 6. 扁平输入与 preset: card

以下输入只在基础消息来自 `preset: text` / `markdown` / `card`（或模板的 `extends` 是它们）时生效：

| 输入 | 映射 |
| --- | --- |
| `title` | `main_title.title`；空时回退 `repo.full_name` |
| `subtitle` | `main_title.desc` |
| `content` | `text_notice.sub_title_text`；有 `image-url` 时是 `image_text_area.desc` |
| `info` | `horizontal_content_list`（最多 6；`key: value` 行或 JSON 数组） |
| `links` | `jump_list`（最多 3；`title \| url` 行或 JSON 数组） |
| `link-url` | `card_action.url`；为空时使用第一条链接、事件详情 URL、仓库 URL |
| `link-title` | 没有 `links` 时生成一条跳转链接的标题；默认 `查看详情` |
| `image-url` | 非空 → `news_notice` + `card_image.url`；否则 `text_notice` |
| `source` / `source-icon` / `source-color` | `source.desc` / `source.icon_url` / `source.desc_color` |

示例：

```yaml
with:
  webhook: ${{ secrets.WECOM_WEBHOOK }}
  preset: card
  title: "🚀 部署完成 · {{ repo.name }}"
  subtitle: production
  content: "版本 v1.2.3，耗时 2m13s"
  info: |
    版本: v1.2.3
    分支: main
    耗时: 2m13s
  links: |
    查看运行 | https://github.com/teriyakiushi/wecom-notifier/actions
    查看提交 | https://github.com/teriyakiushi/wecom-notifier/commit/abc123
  link-url: https://github.com/teriyakiushi/wecom-notifier/actions
```

`info` / `links` 的内容会作为字符串渲染（支持 `{{ }}`），不会自动截断；超过推荐长度时给 warning，而不是静默裁剪。纯文本行没有 `type` 也可以合法，不要求 `url`。

## 7. dry-run、输出与失败

### dry-run

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    dry-run: "true"
    preset: card
    title: 测试
```

- 不发送请求；`webhook` 可以为空。
- 渲染、剪空、归一、截断、校验仍会执行。
- 本地 CLI 在 16KB 以内直接打印 JSON；Action 中写入 `payload` 输出和 step summary，日志不打印大 payload。
- 校验失败时 `fail-on-error: true` 会让 step 失败；设为 `false` 只 warning。
- 加 `html: preview.html` 会同时写一份可视化预览（手机气泡 + warnings + payload），便于在 CI 里作为 artifact 上传后查看。

### 失败与退出码

| 情况 | `fail-on-error: true`（默认） | `fail-on-error: false` |
| --- | --- | --- |
| 配置/模板/输入错误 | step 失败，`exit 1` | warning，`exit 0`，不发送 |
| 消息校验失败 | step 失败，不发送 | warning，`exit 0`，不发送 |
| 发送失败（网络/业务错误） | step 失败 | warning，`exit 0` |
| dry-run 成功 | step 成功 | step 成功 |

`payload`、`msgtype` 等输出在校验失败时也会写入，方便排查。

## 8. 安全边界

- webhook 与 key 在启动时 `::add-mask::`，错误/调试输出会替换为 `***`。
- 模板上下文不包含 `secrets`、`github.token`、`env`、`inputs`；只能读 `event`、安全的 `github.*` 子集、显式 `vars`。
- 模板路径必须在 `GITHUB_WORKSPACE` 内；绝对路径、`..`、逃逸的 symlink 都会被拒绝。
- 模板解析不是 `eval`；表达式解析器只支持路径、字面量、比较、逻辑和内置过滤器。
- 渲染深度 20、节点 10000、单次循环最多 100 项；超出报错。
- 校验失败绝不发送。
