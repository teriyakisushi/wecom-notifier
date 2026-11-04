# wecom-notifier

把 GitHub 仓库事件推送到企业微信群机器人 Webhook。它是一个 **GitHub Composite Action**：零配置即可发送排版好的事件卡片，也可以按事件拆分模板文件，或直接在 Action YAML 里定义完整消息体。

[English](README.en.md) · [配置文档](docs/configuration.md) · [模板语法](docs/templates.md) · [事件预设](docs/events.md) · [企业微信限制](docs/wecom.md) · [可视化构建器](docs/index.html)

## 特性

- **零配置**：`preset: auto` 根据 `GITHUB_EVENT_NAME` 自动选择推送、PR、Issue、Release、Workflow 等卡片。
- **一事件一文件**：`.github/wecom-notify/wecom-push.yml` 只负责 push，`wecom-pull_request.yml` 只负责 PR，避免所有消息体挤在一个 YAML 里。
- **三级定制**：
  1. Action 输入：`preset: card` + `title` / `subtitle` / `content` / `info` / `links` / `image-url`。
  2. 仓库模板：YAML/JSON 文件 + `{{ }}` 表达式、`$if`、`$each`、过滤器。
  3. 内联 `payload`：直接在 workflow 里写完整企业微信消息。
- **完整消息类型**：`text`、`markdown`、`markdown_v2`、`image`、`news`、`file`、`voice`、`template_card`（`text_notice` / `news_notice`）。
- **发送前校验**：字节数、必填字段、列表上限、图片 MD5、卡片比例等；校验失败绝不发送。
- **安全**：webhook 启动即脱敏；模板不能访问 secrets/token/env；路径限制在 workspace。
- **可本地验证**：`dry-run`、CLI、单元测试、Action 级冒烟测试，不配置 webhook 也能渲染 JSON。
- **配套构建器**：零依赖的 [`docs/index.html`](docs/index.html)，可导出消息 JSON/YAML 和 Action 步骤。

## 快速开始

### 1. 添加 webhook secret

在企业微信群 → 群机器人 → 复制 Webhook URL，然后在 GitHub 仓库：

`Settings → Secrets and variables → Actions → New repository secret`

名称填 `WECOM_WEBHOOK`，值填完整 URL（`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`）。也可以只存 key，Action 会自动拼接默认 API 地址。

### 2. 添加 workflow

```yaml
name: WeCom notify

on:
  push:
  pull_request:
  release:
    types: [published]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      # 只有使用 .github/wecom-notify/ 下的模板文件时才需要 checkout
      - uses: actions/checkout@v4

      - uses: teriyakiushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
```

> 当前仓库还未发布 tag 时，在本仓库或 fork 内测试请把 `uses:` 改成 `uses: ./`。

不写 `preset` 时默认 `auto`：

| 事件 | 默认卡片 |
| --- | --- |
| `push` | 仓库、分支、提交数、最近提交、对比链接 |
| `pull_request` | PR 编号/标题、作者、增删行、状态 |
| `issues` / `issue_comment` | Issue/评论摘要与链接 |
| `release` | tag、Release 名称、说明摘要 |
| `workflow_run` | 工作流结果、分支、运行链接 |
| `star` / `fork` | 新 Star / Fork 信息 |
| `create` / `delete` | 分支或 tag 创建/删除 |
| 其他事件 | 通用 markdown（事件、仓库、触发者、运行链接） |

## 一事件一文件

推荐把复杂定制放在 `.github/wecom-notify/`，每个文件只负责一个事件：

```text
.github/wecom-notify/
├── wecom-push.yml          # 只处理 push
├── wecom-pull_request.yml  # 只处理 pull_request
├── wecom-release.yml       # 只处理 release
└── default.yml            # 可选：没有匹配事件时兜底
```

查找规则：

1. 精确匹配 `<event>.yml` / `<event>.yaml`；
2. 或后缀匹配 `*-<event>.yml` / `*-<event>.yaml`（如 `wecom-push.yml`）；
3. 同一事件匹配到多个文件会报错；
4. 都没有时使用 `default.yml` / `_default.yml`；
5. 再没有就回落到内置预设。

最小示例，只覆盖 push 卡片的来源文字：

```yaml
# .github/wecom-notify/wecom-push.yml
extends: push
overrides:
  template_card:
    source:
      desc: wecom CI
      desc_color: 1
```

完整自定义卡片（只处理 pull_request）：

```yaml
# .github/wecom-notify/wecom-pull_request.yml
msgtype: template_card
template_card:
  card_type: text_notice
  source:
    desc: "{{ repo.name }}"
    desc_color: 1
  main_title:
    title: "🔀 PR #{{ pr.number }}"
    desc: "{{ pr.title | truncate: 30 }}"
  sub_title_text: "{{ pr.user.login }} · {{ pr.base.ref }} ← {{ pr.head.ref }}"
  horizontal_content_list:
    - keyname: 状态
      value: "{{ pr.state }}"
    - keyname: 来源
      value: "{{ pr.head.ref }}"
    - keyname: 目标
      value: "{{ pr.base.ref }}"
  card_action:
    type: 1
    url: "{{ pr.html_url }}"
```

> 使用模板文件时，workflow 里要先 `actions/checkout`，否则 runner 上看不到仓库里的 `.github/wecom-notify/`。

## 在 Action YAML 里定制

### 简单卡片

```yaml
- uses: teriyakiushi/wecom-notifier@v1
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
      查看运行 | ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      查看提交 | ${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}
    link-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

`image-url` 非空时会自动使用 `news_notice` 图文卡片。

### 深合并任意字段

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: push
    overrides: |
      template_card:
        source:
          desc: 我的机器人
          desc_color: 3
        main_title:
          title: "📦 {{ repo.name }} / {{ ref_name }}"
```

`overrides` 是深合并：对象逐键合并，数组整体替换，`null` 删除键，`0`/`false` 保留。

### 内联完整消息

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    payload: |
      msgtype: markdown
      markdown:
        content: |
          ## 构建成功 ✅
          > 仓库：{{ repo.full_name }}
          > 分支：{{ ref_name }}
          > 提交人：{{ actor }}
```

`payload` 与 `template` 不要同时设置；需要同时使用时，把文件内容写进 `payload` 或只保留一个来源。

## 模板语法速览

```yaml
msgtype: template_card
template_card:
  card_type: text_notice
  main_title:
    title: "{{ repo.name }}"
    desc: "{{ event_name }} · {{ actor | default('未知') }}"

  # 按结论切换整块内容，未写的字段自动保留
  variants:
    by: workflow_run.conclusion
    cases:
      success: { source: { desc: "通过", desc_color: 3 } }
      failure: { source: { desc: "失败", desc_color: 2 } }
    default: { source: { desc: "运行中", desc_color: 0 } }

  # 条件成立才保留；写在数组元素上就是“这一行消失”
  horizontal_content_list:
    - when: commit_count > 0
      keyname: 提交
      value: "{{ commit_count }}"

  # 遍历数组
  vertical_content_list:
    for: commits
    limit: 3
    item:
      title: "{{ item.short_sha }}"
      desc: "{{ item.first_line | truncate(40) }}"

  card_action:
    type: 1
    url: "{{ detail_url }}"
```

- 表达式：路径、字面量、`==`/`!=`/`>`/`<`、`&&`/`||`/`!`、括号、过滤器。
- 指令：`when`/`$if`、`for`/`$each`、`item`/`$item`、`as`/`$as`、`limit`/`$limit`、`join`/`$join`、`prefix`/`$prefix`、`suffix`/`$suffix`；两种写法等价，`$` 写法继续支持。
- `variants`：`{ by, cases, default }`，命中的分支深度合并到本对象，分支里写 `null` 可删除兄弟键。
- 过滤器：`default`、`truncate`、`truncateBytes`、`firstLine`、`oneLine`、`upper`/`lower`、`replace`、`join`、`take`/`skip`、`first`/`last`、`length`、`json`、`urlencode`、`escapeMd`。
- 上下文：`event`、`event_name`、`actor`、`repo.*`、`github.*`、`ref_name`、`sha`、`short_sha`、`workflow`、`run_id`、`run_url`、`now`、`vars.*`、`commits`、`pr`、`issue`、`release`、`workflow_run` 等；**不包含 secrets/token/env**。
- 限制：渲染深度 20、节点 10000、单次 `for` 最多 100 项；模板文件路径必须在 workspace 内。
- 本地检查：`npm run dev -- --dry-run --html preview.html ...` 生成可视化预览；`npm run lint:templates` 渲染 `examples/` 里的模板并检查报错与字段超长。

完整语法、上下文表和限制见 [docs/templates.md](docs/templates.md)。

## 输入与输出

常用输入：

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `webhook` | 空（dry-run 可用） | 完整 Webhook URL 或仅 key；建议放 secret |
| `preset` | `auto` | `auto` / 事件名 / `text` / `markdown` / `card` / `none` |
| `payload` | 空 | 内联 YAML/JSON 消息或配置 |
| `template` | 空 | 显式模板文件；优先于 `template-dir` |
| `template-dir` | `.github/wecom-notify` | 按事件查找模板；空字符串禁用 |
| `overrides` | 空 | YAML/JSON 深合并补丁 |
| `vars` | 空 | YAML/JSON 变量，模板里用 `vars.*` |
| `dry-run` | `false` | 只渲染和校验，不发送 |
| `fail-on-error` | `true` | 校验/发送失败时是否让 step 失败 |
| `auto-truncate` | `true` | 自动截断 text/markdown/news 的硬字节限制 |
| `timeout` / `retries` | `10` / `2` | 单次超时秒数；可重试错误的重试次数 |
| `api-base` | `https://qyapi.weixin.qq.com` | `webhook` 只传 key 时使用的 API 基址 |
| `debug` | `false` | 输出不含密钥的诊断信息 |
| `html` | 空 | dry-run 时额外写一份自包含 HTML 预览到该路径 |

输出：`msgtype`、`payload`（渲染后的 JSON，最多 64KB）、`errcode`、`errmsg`。

完整输入表、来源优先级和配置文档格式见 [docs/configuration.md](docs/configuration.md)。

## 企业微信限制

- 每个 webhook 最多 **20 条/分钟**；超限返回 `45009`，Action 会退避重试。
- `text.content` ≤ 2048 字节；`markdown` / `markdown_v2` ≤ 4096 字节。
- `news.articles` 1–8 条；标题 ≤ 128 字节，描述 ≤ 512 字节。
- 卡片 `text_notice` 至少要有 `main_title.title` 或 `sub_title_text`，且 `card_action` 必填。
- 卡片图片必须是企业微信可访问的公网 URL；`image` 消息可内联 base64（≤ 2MB，JPG/PNG）。
- `file` / `voice` 只透传 `media_id`，需要先用企业微信 `upload_media` 上传；media_id 3 天有效，且只对同一 webhook 有效。

详见 [docs/wecom.md](docs/wecom.md) 和官方文档 [91770](https://developer.work.weixin.qq.com/document/path/91770)。

## 安全

- webhook URL 等同凭证，不要提交到仓库、不要打印到日志。Action 会在启动时 `::add-mask::`，并对错误信息脱敏。
- 模板上下文不包含 `secrets`、`github.token`、`env` 或 Action inputs；只能读取事件和显式 `vars`。
- 不要用 `pull_request_target` + checkout PR 代码 + secrets 的组合；来自 fork 的 PR 默认拿不到 secrets。
- 模板只能访问 workspace 内的文件，并有大小、深度、节点数限制。
- 校验失败不会发送；`fail-on-error: false` 只降级为 warning。

安全问题请通过 GitHub Security Advisories 私下报告，见 [SECURITY.md](SECURITY.md)。

## 本地运行

要求 Node.js ≥ 18。

```bash
npm install
npm test
npm run build
npm run build:check

# 用示例事件 dry-run，不需要 webhook
node src/cli.mjs --dry-run \
  --event-name push \
  --event tests/fixtures/events/push.json

# 本地渲染卡片
node src/cli.mjs --dry-run --preset card \
  --title "部署完成" --subtitle production \
  --content "版本 v1.2.3"
```

本地 CLI 的完整参数：

```bash
node src/cli.mjs --help
```

构建产物 `dist/index.mjs` 由 esbuild 打包（含 YAML 解析器），是 Action 实际运行的入口；修改源码后要重新 `npm run build` 并提交 `dist/`。

## 文档

- [配置：输入、输出、来源优先级](docs/configuration.md)
- [模板语法、表达式、指令、上下文](docs/templates.md)
- [事件预设与自定义示例](docs/events.md)
- [企业微信消息类型与限制](docs/wecom.md)
- [排错](docs/troubleshooting.md)
- [开发与发布](docs/development.md)
- [可视化构建器](docs/index.html)
- [示例](examples/README.md)

## License

[MIT](LICENSE) © 2026 teriyakiushi
