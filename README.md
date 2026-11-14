<h1 align="center">wecom-notifier</h1>

<p align="center">把 GitHub 仓库事件推送到企业微信群机器人 —— 一个零运行时依赖的 Composite Action。</p>

<p align="center">
  <a href="https://github.com/teriyakisushi/wecom-notifier/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/teriyakisushi/wecom-notifier/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/teriyakisushi/wecom-notifier/releases"><img alt="Release" src="https://img.shields.io/github/v/release/teriyakisushi/wecom-notifier?label=release"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/teriyakisushi/wecom-notifier"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
</p>

<p align="center">
  <a href="https://teriyakisushi.github.io/wecom-notifier/"><b>🔧 消息构建器</b></a> ·
  <a href="docs/">文档</a> ·
  <a href="examples/">示例</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="README.en.md">English</a>
</p>

```yaml
- uses: teriyakisushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
```

两行接入：`push`、PR、Issue、Release、`workflow_run`、Star、Fork 等事件会自动变成排版好的企业微信卡片；需要时也可以按事件拆分模板，或直接写完整消息体。

## 特性

- **零配置可用**：`preset: auto` 按 `GITHUB_EVENT_NAME` 选卡片，不给模板也能发。
- **一事件一文件**：`.github/wecom-notify/wecom-push.yml` 只管 push，`wecom-pull_request.yml` 只管 PR，不把所有消息挤进一个 YAML。
- **三级定制**：Action 输入 → 仓库模板文件 → 内联 `payload`，随时可以只改一层。
- **8 种消息类型**：`text`、`markdown`、`markdown_v2`、`image`、`news`、`file`、`voice`、`template_card`（`text_notice` / `news_notice`）。
- **发送前校验**：字节数、必填字段、列表上限、图片 MD5、卡片比例等全部先校验，失败绝不发送。
- **可离线验证**：`dry-run`、本地 CLI、单元测试与 Action 级冒烟测试，没有 webhook 也能渲染出 JSON 和 HTML 预览。

## 快速开始

### 1. 添加 webhook secret

企业微信群 → 群机器人 → 复制 Webhook URL，然后在仓库
`Settings → Secrets and variables → Actions → New repository secret` 新建 `WECOM_WEBHOOK`。

值可以是完整 URL（`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`），也可以只存 key，Action 会补上默认 API 地址。

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

      - uses: teriyakisushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
```

> 在本仓库或 fork 里试跑时，把 `uses:` 改成 `uses: ./`。

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

## 消息构建器

不想手写卡片 JSON？用在线构建器：**<https://teriyakisushi.github.io/wecom-notifier/>**

- 左边填字段，右边实时预览，版式与群里基本一致；
- 导入已有的模板文件继续改，或从「载入示例」开始；
- 一键导出 **JSON / YAML / Action 步骤 / 模板文件**，导出的结构就是 Action 真正接受的结构；
- 纯前端、离线可用（也可以直接打开仓库里的 [`docs/index.html`](docs/index.html)），不会上传 webhook 或任何内容。

## 定制

### 一事件一文件（推荐）

```text
.github/wecom-notify/
├── wecom-push.yml          # 只处理 push
├── wecom-pull_request.yml  # 只处理 pull_request
├── wecom-release.yml       # 只处理 release
└── default.yml             # 可选：没有匹配事件时兜底
```

查找规则：

1. 精确匹配 `<event>.yml` / `<event>.yaml`；
2. 或后缀匹配 `*-<event>.yml` / `*-<event>.yaml`（如 `wecom-push.yml`）；
3. 同一事件匹配到多个文件会报错；
4. 都没有时用 `default.yml` / `_default.yml`；
5. 再没有就回落到内置预设。

最小改动——只覆盖 push 卡片的来源文字：

```yaml
# .github/wecom-notify/wecom-push.yml
extends: push
overrides:
  template_card:
    source:
      desc: wecom CI
      desc_color: 1
```

<details>
<summary>完整 PR 卡片示例</summary>

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

</details>

> 使用模板文件时，workflow 要先 `actions/checkout`，否则 runner 上看不到 `.github/wecom-notify/`。
> 更多模板见 [`examples/`](examples/)，可以直接 `npm run preview` 渲染成 HTML 再决定要不要发。

### 在 Action YAML 里定制

**简单卡片**（`preset: card`）：

```yaml
- uses: teriyakisushi/wecom-notifier@v1
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
```

`image-url` 非空时自动切换到 `news_notice` 图文卡片。

**深合并任意字段**（`overrides`）：

```yaml
- uses: teriyakisushi/wecom-notifier@v1
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

对象逐键合并，数组整体替换，`null` 删除键，`0` / `false` 保留。

**内联完整消息**（`payload`）：

```yaml
- uses: teriyakisushi/wecom-notifier@v1
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

`payload` 与 `template` 不要同时设置；需要复用时把文件内容写进 `payload`，或只保留一个来源。

## 模板语法

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

  # 条件成立才保留；写在数组元素上就是「这一行消失」
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

- 表达式：路径、字面量、`==` / `!=` / `>` / `<`、`&&` / `||` / `!`、括号、过滤器。
- 指令：`when` / `$if`、`for` / `$each`、`item` / `$item`、`as` / `$as`、`limit` / `$limit`、`join` / `$join`、`prefix` / `$prefix`、`suffix` / `$suffix`，两种写法等价。
- `variants`：`{ by, cases, default }`，命中的分支深度合并到本对象，分支里写 `null` 可删除兄弟键。
- 过滤器：`default`、`truncate`、`truncateBytes`、`firstLine`、`oneLine`、`upper` / `lower`、`replace`、`join`、`take` / `skip`、`first` / `last`、`length`、`json`、`urlencode`、`escapeMd`。
- 上下文：`event`、`event_name`、`actor`、`repo.*`、`github.*`、`ref_name`、`sha`、`short_sha`、`workflow`、`run_id`、`run_url`、`now`、`vars.*`、`commits`、`pr`、`issue`、`release`、`workflow_run` 等；**不包含 secrets / token / env**。
- 限制：渲染深度 20、节点 10000、单次 `for` 最多 100 项；模板文件路径必须在 workspace 内。

完整语法、上下文表和限制见 [docs/templates.md](docs/templates.md)；本地可以用 `npm run dev -- --dry-run --html preview.html ...` 生成可视化预览，`npm run lint:templates` 会渲染 `examples/` 里的模板并检查报错与字段超长。

## 输入与输出

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

- webhook URL 等同凭证：不要提交进仓库、不要打印到日志。Action 启动即 `::add-mask::`，并对错误信息脱敏。
- 模板上下文不包含 `secrets`、`github.token`、`env` 或 Action inputs，只能读事件与显式 `vars`。
- 不要用 `pull_request_target` + checkout PR 代码 + secrets 的组合；来自 fork 的 PR 默认拿不到 secrets。
- 模板只能访问 workspace 内的文件，并有大小、深度、节点数限制。
- 校验失败不会发送；`fail-on-error: false` 只降级为 warning。

安全问题请通过 [SECURITY.md](SECURITY.md) 里的渠道私下报告。

## 本地开发

要求 Node.js ≥ 18。

```bash
npm ci
npm test                 # 单元测试
npm run build            # 打包 dist/index.mjs（要提交）
npm run build:check      # 校验 dist 与源码一致

# 用示例事件 dry-run，不需要 webhook
node src/cli.mjs --dry-run \
  --event-name push \
  --event tests/fixtures/events/push.json

# 本地渲染卡片
node src/cli.mjs --dry-run --preset card \
  --title "部署完成" --subtitle production \
  --content "版本 v1.2.3"

node src/cli.mjs --help  # 完整参数
```

`dist/index.mjs` 由 esbuild 打包（含 YAML 解析器），是 Action 真正的入口；改完源码记得 `npm run build` 并一起提交。发版流程见 [docs/development.md](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/configuration.md](docs/configuration.md) | 输入、输出、来源优先级 |
| [docs/templates.md](docs/templates.md) | 模板语法、表达式、指令、上下文 |
| [docs/events.md](docs/events.md) | 事件预设与自定义示例 |
| [docs/wecom.md](docs/wecom.md) | 企业微信消息类型与限制 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 常见报错与排错 |
| [docs/development.md](docs/development.md) | 目录结构、测试、CI 与发布 |
| [examples/](examples/README.md) | 可直接复制的卡片与 workflow |
| [消息构建器](https://teriyakisushi.github.io/wecom-notifier/) | 在线拼消息、导出 JSON / YAML |

## 贡献

欢迎 Issue 与 PR：先看 [CONTRIBUTING.md](CONTRIBUTING.md)，提交前跑 `npm test`、`npm run lint:templates` 和 `npm run build:check`。安全策略见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE) © 2026 teriyakisushi
