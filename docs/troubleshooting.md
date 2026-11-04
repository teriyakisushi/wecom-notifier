# 故障排查

先按“消息有没有生成 → 有没有发出去 → 对方有没有收到”分段定位。Action 默认 `fail-on-error: true`；如果 step 是绿的但没收到消息，优先检查 `dry-run`、workflow 触发条件和企业微信侧限制。

## 1. 快速检查表

| 现象 | 先看 |
| --- | --- |
| Action 根本没运行 | workflow 的 `on:` 是否包含该事件；job/step 的 `if:`；仓库默认分支上的 workflow；fork PR 的 secret 限制 |
| 运行了但没消息 | `dry-run` 是否为 `true`；`preset: none` 且没有 payload/overrides；`template-dir` 是否因为没有 checkout 而找不到文件 |
| 报 `E_WEBHOOK_MISSING` | 非 dry-run 必须提供 `webhook`；secret 是否为空 |
| 报 `E_VALIDATION` | 看 issues 的 `path`/`code`；先用 builder 或 `payload` 输出定位字段 |
| 企业微信返回 93000 | webhook URL 错误、机器人被移出群、群被解散；重新复制 webhook |
| 企业微信返回 45009 | 超过 20 条/分钟；Action 会重试，仍失败就降低频率或合并消息 |
| 收到了但排版不对 | 客户端版本（markdown_v2）、字段超推荐长度、图片/链接不可访问 |
| 本地能跑、Actions 里不行 | 是否 checkout；workspace/working-directory；`uses: ./` 的路径；Node 版本；secret 是否传到 step |

## 2. Action 没有运行 / 被跳过

### 触发条件

```yaml
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, closed]
```

- `on:` 没有该事件，workflow 不会启动；`pull_request` 默认只触发 `opened/synchronize/reopened`，`closed` 需要显式列出。
- `issue_comment`、`workflow_run` 等事件需要在默认分支上的 workflow 才会触发。
- job/step 的 `if:` 可能把通知跳过了；调试时先临时去掉 `if`。
- 从 fork 来的 PR 默认拿不到 secrets；这是 GitHub 的安全限制，不是 Action 的问题。

### 没有 checkout

```yaml
steps:
  - uses: actions/checkout@v4   # 需要模板文件时必须有
  - uses: teriyakiushi/wecom-notifier@v1
    with:
      webhook: ${{ secrets.WECOM_WEBHOOK }}
```

没有 checkout 时 runner 上没有 `.github/wecom-notify/`，Action 会回落到内置预设。如果你期望自定义模板，先加 checkout；或者改用 `payload` 内联消息。

### `template-dir` 写错

- 默认是 `.github/wecom-notify`，相对 `GITHUB_WORKSPACE`。
- 路径必须在 workspace 内；绝对路径或 `..` 会报 `E_PATH`。
- 目录不存在时会静默回落到内置预设；路径越界、不是目录或无法读取才报 `E_TEMPLATE_DIR`。要完全禁用自动查找，把 `template-dir` 设为空字符串。
- 只扫描第一层，不递归；文件名只接受 `.yml`/`.yaml`。

## 3. webhook / 企业微信错误

### `E_WEBHOOK_MISSING`

非 dry-run 且 `webhook` 为空。检查：

```yaml
with:
  webhook: ${{ secrets.WECOM_WEBHOOK }}
```

- secret 名是否拼对；
- 是否在 fork PR 中（secret 不可用）；
- 是否把 secret 放在 `env:` 而不是 `with:`。

### `E_WEBHOOK_URL` / `E_WEBHOOK_KEY` / `E_WEBHOOK_FORMAT`

- 完整 URL 必须是 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`，且带 `key`。
- 只传 key 时，不能带空格、引号或 `key=` 前缀；Action 会拼到 `api-base`。
- 完整 URL 没有 `key` 参数 → `E_WEBHOOK_KEY`。
- 既不是合法 URL 也不是裸 key → `E_WEBHOOK_FORMAT`。

### 企业微信返回码

| errcode | 处理 |
| --- | --- |
| 93000 | 重新复制 webhook；确认机器人还在目标群、群未解散。 |
| 93001 / 93004 | 群设置不允许推送/推送被停用；找群管理员。 |
| 93006 / 93008 | 群 ID/成员关系异常；重新添加机器人。 |
| 93017 | 请求体为空；检查模板是否渲染成空对象。 |
| 93018 | 图片过大；压缩到 2MB 以内。 |
| 45008 | 图文超过 8 条；减少 `articles`。 |
| 45009 | 超过 20 条/分钟；Action 会自动退避重试，仍失败就降低频率。 |
| 40058 | 参数不合法；先看本地校验，确保字段类型/枚举正确。 |

业务错误（93000、45008 等）不会重试；网络错误、超时、5xx、429、45009 会重试。重试次数用 `retries` 控制（默认 2）。

## 4. 模板找不到 / 二义性

### `E_TEMPLATE_NOT_FOUND`

显式 `template` 指定的文件不存在。检查：

- 路径是否相对 workspace；
- 是否忘了 `actions/checkout`；
- 文件名大小写（Linux runner 区分大小写）；
- `template` 和 `template-dir` 同时设置时，`template` 优先，不会去目录里找。

### `E_TEMPLATE_AMBIGUOUS`

同一事件匹配到多个文件，例如同时存在：

```text
.github/wecom-notify/push.yml
.github/wecom-notify/wecom-push.yml
```

只保留一个。默认文件同理：`default.yml` 和 `_default.yml` 不能同时存在。

### `E_TEMPLATE_CONFLICT`

同时设置了 `payload` 和 `template`。二选一；`payload` 优先，但显式冲突会直接报错，避免你以为模板生效了。

### 模板文件没生效

顺序是：

```text
payload > template > template-dir 自动查找 > preset
```

- 设置了 `payload`，模板永远不会读；
- 设置了 `template`，目录查找不会发生；
- 事件文件只在 `template-dir` 自动查找时参与；
- `template-dir: ''` 会禁用自动查找，直接走 `preset`。

## 5. YAML / JSON 错误

### `E_YAML`

错误信息通常带行/列：

```text
E_YAML: Nested mappings are not allowed in compact mappings at line 50, column 18
```

常见原因：

- 普通标量里出现 `: `（冒号+空格），例如 `desc: 说明: 这里`；给整段加引号，或用块标量 `|`。
- 用了 Tab 缩进；YAML 只允许空格。
- 同一 mapping 重复键；`parseDocument` 开了 `uniqueKeys`，会报错。
- 引号没闭合；多行文本用 `|` / `>`。
- 锚点/别名过多（上限 100）。

### 模板文件过大

上限 5MB；超过报 `E_TEMPLATE_TOO_LARGE`。通知模板不该接近这个量级，通常是误把构建产物放进来了。

## 6. 模板表达式错误

### `E_TEMPLATE_EXPR`

`{{` 未闭合、路径非法、空表达式、非法字符。检查：

```yaml
title: "{{ repo.name }}"     # 正确
title: "{{ repo.name }"      # 少一个 }
title: "{{ }}"               # 空表达式
```

要输出字面量 `{{`，写 `\{{`，并用单引号/块标量：

```yaml
content: '示例：\{{ 这不是模板 }}'
```

### `E_TEMPLATE_FILTER`

未知过滤器或参数不合法。允许的过滤器见 [模板 §3](templates.md#3-过滤器)；没有 `date`、`slice`、`regex` 等任意函数。`replace` 是普通文本替换，不是正则。

### `E_TEMPLATE_RENDER`

常见原因：

- `$each` 的源不是数组：`$each: repo`；
- `$limit` 不是正整数；
- `$as` 写成了表达式：`$as: "{{ x }}"`，应写 `$as: commit`；
- `$prefix` / `$suffix` 没有配 `$join`；
- `$each` 和 `$if` 放在同一个对象；
- 未知 `$` 指令（例如 `$map`）；
- 深度超过 20 或节点超过 10000；
- 单次 `$each` 超过 100 项（会截断并给 `W_EACH_LIMIT` warning，不是错误）。

### 路径为空

找不到的字段渲染为空；如果整段表达式找不到，得到 `undefined`，随后被剪空。用 `default` 兜底：

```yaml
desc: "{{ event.pull_request.body | default('无描述') | truncate(60) }}"
```

## 7. 校验失败 `E_VALIDATION`

错误会列出每个 issue 的 `code`、`path`、`message`。常见：

| code | 含义 | 修复 |
| --- | --- | --- |
| `E_URL_REQUIRED` | 必填 URL 为空 | 补 `url` / `link-url` / `card_action.url` |
| `E_URL_INVALID` | 不是 http(s) URL | 用完整 `https://...` |
| `E_TEXT_TOO_LONG` | text 超过 2048 字节 | 开 `auto-truncate` 或缩短 |
| `E_MARKDOWN_TOO_LONG` | markdown 超过 4096 字节 | 缩短/截断 |
| `E_IMAGE_FORMAT` | 不是 JPG/PNG | 换图 |
| `E_HORIZONTAL_COUNT` | 键值行超过 6 | 减到 6 行以内 |
| `E_JUMP_COUNT` | 跳转超过 3 | 减到 3 条以内 |
| `E_CARD_ACTION` | 卡片没有 `card_action` | 补 `card_action` 或 `link-url` |
| `E_CARD_TYPE` | `card_type` 不是 text_notice/news_notice | 用 webhook 支持的类型 |
| `E_NEWS_COUNT` | 图文不是 1–8 条 | 调整 `articles` |
| `E_CARD_IMAGE` | news_notice 缺 `card_image.url` | 补封面 URL |
| `W_FIELD_LENGTH` | 超过推荐长度 | 通常可忽略；企业微信可能截断 |

卡片字段的“必填/选填”以 [企业微信格式](wecom.md#8-模板卡片-template_card) 为准。特别注意：

- `horizontal_content_list.type` 可以不填（纯文本），不要为了过校验硬加 `type: 1`，否则会要求 `url`；
- `jump_list.type` 不填或 0 表示非链接；
- `quote_area.type` 不填或 0 表示无点击；
- `pagepath` 在 type 2 时是选填。

### `auto-truncate` 做了什么

只裁硬限制：text 2048 字节、markdown/markdown_v2 4096 字节、news 标题 128 字节/描述 512 字节。卡片推荐长度不会自动裁，只给 warning。被裁剪时日志有 `W_TRUNCATED`。

## 8. 输出/日志相关

### `payload` 被截断

Action 输出的 `payload` 上限 64KB，超出会加：

```text
… [truncated for GitHub output]
```

完整消息在发送请求里；本地 dry-run 可直接看文件/终端。不要把大 payload 当唯一证据。

### 看不到 secrets

这是有意的：webhook/key 会 `::add-mask::`，日志里显示 `***`。调试时不要临时打印 secret；用 dry-run 和输出结构定位。

### 没有 `GITHUB_OUTPUT`

本地运行没有该文件时，dry-run 在 16KB 以内直接把 JSON 打到 stdout；Action 里由 GitHub 提供 `GITHUB_OUTPUT`。

## 9. 本地复现

```bash
# 源码直接跑
npm run dev -- --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push

# 打包产物跑（和 Action 一致）
node dist/index.mjs --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push

# 指定卡片
node dist/index.mjs --dry-run --preset card \
  --title 部署完成 --content "v1.2.3" \
  --link-url https://github.com/teriyakiushi/wecom-notifier
```

模拟 Action 环境：

```bash
WECOM_INPUTS='{"dry-run":"true","preset":"card","title":"测试"}' \
GITHUB_EVENT_NAME=push \
GITHUB_EVENT_PATH=tests/fixtures/events/push.json \
GITHUB_WORKSPACE="$PWD" \
GITHUB_OUTPUT=/tmp/wecom-output \
node dist/index.mjs
```

- `WECOM_INPUTS` 会覆盖 `INPUT_*`，CLI 参数优先级最高。
- `--debug` 输出诊断信息，但仍会 redact webhook/key。
- 没有 `GITHUB_EVENT_PATH` 时用 `--event` 指定 JSON 文件。

## 10. 本地能跑、Actions 里失败

按顺序检查：

1. **checkout**：模板文件在仓库里，但 runner 没 checkout。
2. **路径**：`template-dir` 相对 workspace；`working-directory` 不会改变 `GITHUB_WORKSPACE`。
3. **action 版本**：`uses: teriyakiushi/wecom-notifier@v1` 是否指向包含 `dist/` 的 tag；开发时用 `uses: ./`。
4. **Node 版本**：Action 要求 Node ≥18；self-hosted runner 可能更旧。
5. **secret**：fork PR、environment 保护规则、组织 secret 权限。
6. **事件名**：`GITHUB_EVENT_NAME` 和你以为的不一样；例如 Star 是 `watch`，不是 `star`。
7. **事件 payload**：某些事件没有 `commits`、`pull_request`；用 `{{ event | json }}` 临时看结构（注意不要打印敏感字段；事件 payload 本身不含 secrets）。
8. **权限**：通知本身不需要 `contents: write`；如果 workflow 还做别的操作，失败可能不在通知 step。

## 11. 安全问题

- 不要把 webhook URL 写进 issue、日志、截图或公开仓库。
- 模板上下文不提供 secrets；不要在模板里尝试 `env`/`secrets`，它们不存在。
- 模板文件来自 PR 时，注意 PR 可以改消息内容；对不可信 PR 使用 `pull_request_target` 要特别小心，不要在该 workflow 里 checkout 并执行 PR 代码。
- 发现泄露：立即在群机器人设置里重置 webhook，并检查 Actions 日志/仓库历史。

更多错误码可查企业微信文档或 [错误码查询工具](https://open.work.weixin.qq.com/devtool/query)。
