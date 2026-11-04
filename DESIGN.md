# wecom-notifier 设计方案

> 状态：v0.1 设计稿，**待确认**（2026-11-02）
> 目标仓库：`wecom-notifier`（当前目录）
> 调研依据：企业微信「群机器人配置说明」(91770)、企业微信全局错误码 (90313)、GitHub Composite Action 文档、GitHub Events 文档、现有 `webcom.html` 构建器。
> 若同意第 14 节的推荐项，回复「按推荐执行」即可开始实现。

---

## 1. 目标与非目标

### 1.1 目标

做一个 **GitHub Composite Action**，把 GitHub 仓库事件以企业微信群机器人消息的形式推送，并支持从三个层次自定义消息体：

1. **零配置**：`uses: <owner>/wecom-notifier@v1` + `webhook`，自动根据事件生成一张排版好的模板卡片。
2. **Action YAML 内定制**：`preset: card` 加 `title` / `subtitle` / `content` / `info` / `links` / `image-url` 等扁平输入，或 `overrides` 深合并任意字段。
3. **仓库内自定义文本**：在 `.github/wecom-notify/` 下按事件拆分（如 `push.yml` / `wecom-push.yml`），每个文件只负责一个事件的消息体，支持 `{{ }}` 变量、`$if` 条件、`$each` 循环和常用过滤器；也可在 Action 的 `payload:` 中直接内联。

同时提供：

- **本地/CI 可验证**：`dry-run`、本地 CLI、单元/集成测试、Action 级冒烟测试。
- **安全**：webhook 视为凭证，日志脱敏；模板只能访问事件上下文、GitHub 元数据和显式 `vars`，不能读取 `secrets`、`token` 或 `process.env`。
- **可维护**：零运行时安装（Node 脚本 + 打包的 YAML 解析器），跨 ubuntu/windows/macos。
- **配套构建器**：把现有 `webcom.html` 升级为零依赖的可视化构建器，修复数值类型、MD5、校验等缺陷，并能导出 Action 配置/模板。

### 1.2 非目标（v1）

- 不做企业微信「应用消息」、通讯录、审批等 API，只做**群机器人 webhook**。
- 不做双向交互（webhook 的 `template_card` 不支持 `button_interaction`）。
- 不托管图片/素材；卡片图片必须是企业微信可访问的**公网 URL**。`image` 消息可内联 base64。
- 不做 file/voice 的**上传**封装（`media_id` 可由用户自行上传后传入；见 §7.1）。
- 不做消息队列、去重、跨 webhook 限流服务（仅按官方 20 条/分钟约束重试）。
- 不引入运行时 npm 依赖（构建期依赖会被 bundle 进 `dist/index.mjs`）。

---

## 2. 调研结论（决定设计的关键事实）

### 2.1 企业微信群机器人

- 发送接口：`POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY`，JSON body，成功返回 `{"errcode":0,"errmsg":"ok"}`。
- 支持 8 种消息：`text`、`markdown`、`markdown_v2`、`image`、`news`、`file`、`voice`、`template_card`。
- 频率：每个 webhook **≤20 条/分钟**；超限返回 `45009`。
- 关键硬限制：

| 类型 | 硬限制 |
| --- | --- |
| `text` | `content` ≤ 2048 字节（UTF-8）；`mentioned_list` / `mentioned_mobile_list` |
| `markdown` | `content` ≤ 4096 字节；支持标题、粗体、链接、行内代码、引用、`<font color="info\|comment\|warning">` |
| `markdown_v2` | `content` ≤ 4096 字节；不支持颜色/@；支持列表、表格、图片、分割线、代码块；旧客户端降级为纯文本 |
| `image` | `base64`（图片本身）≤ 2MB；JPG/PNG；需 `md5` |
| `news` | `articles` 1–8 条；`title` ≤128 字节；`description` ≤512 字节；`url` 必填；`picurl` 可选 |
| `file` | `media_id`；通过 upload_media 上传，≤20MB |
| `voice` | `media_id`；AMR，≤2MB，≤60 秒 |
| `template_card` | 仅 `text_notice` / `news_notice`；见下 |

- `template_card` 公共约束：
  - `source.desc_color`：0 灰、1 黑、2 红、3 绿（Int）。
  - 文本通知卡（`text_notice`）：`main_title.title` 和 `sub_title_text` 至少一项；`card_action` **必填**；`horizontal_content_list` ≤6；`jump_list` ≤3；`emphasis_content` 与 `quote_area` 建议不同时使用。
  - 图文通知卡（`news_notice`）：`main_title.title` 必填；`card_image.url` 必填；`aspect_ratio` 官方范围 `1.3 < r < 2.25`，默认 1.3（实现允许 1.3）；`vertical_content_list` ≤4；`card_action` **必填**。
  - 推荐长度（**建议值**，不是硬限制）：`source.desc` ≤13 字、`main_title.title` ≤26 字、`main_title.desc` ≤30 字、`emphasis_content.title` ≤10 字 / `desc` ≤15 字、`sub_title_text` ≤112 字、`keyname` ≤5 字、`value` ≤26 字、`jump_list.title` ≤13 字、`vertical_content_list.title` ≤26 字 / `desc` ≤112 字。
  - 点击区域类型：`quote_area.type` / `jump_list.type` / `image_text_area.type` / `card_action.type`：0（无事件）/1（URL）/2（小程序）；`horizontal_content_list.type`：1（URL）/2（文件 media_id）/3（成员 userid）。
- 错误码（已核对 90313）：

| errcode | 含义 | 处理建议 |
| --- | --- | --- |
| 93000 | webhook URL 不合法 / 机器人被移出群 | 检查 secret、重新添加机器人 |
| 93001 | 当前群聊不允许推送 | 群管理员设置 |
| 93004 | 消息推送被停用 | 启用机器人 |
| 93006 | 不合法的群 ID | 重新获取 webhook |
| 93008 | 不在群里 | 重新获取 webhook |
| 93017 | 请求内容不能为空 | 模板渲染为空 |
| 93018 | 图片大小超限 | 压缩/换图 |
| 45008 | 图文文章数超限（>8） | 减少 articles |
| 45009 | 接口调用超过限制 | 降频/重试 |
| 40058 | 不合法的参数 | 按校验提示修正字段 |

- **webhook URL 等同凭证**，不能公开；日志里必须脱敏。

### 2.2 GitHub Composite Action 约束

- `action.yml` 使用 `runs.using: composite`；每个 step 必须显式 `shell`。
- Action 自身目录用 `${{ github.action_path }}` 取，传入 env 后在 `run` 里用 `$WECOM_ACTION_PATH`。
- `GITHUB_EVENT_PATH` 由 runner 设置，指向事件 JSON；`GITHUB_EVENT_NAME`、`GITHUB_REPOSITORY`、`GITHUB_*` 均可用。
- `toJSON(inputs)` 可以一次性把全部 inputs 传入 Node，避免在 `action.yml` 里写 20+ 个 `INPUT_*`；大内容建议走模板文件（Windows 单环境变量约 32KB）。
- Composite action 不需要 `GITHUB_TOKEN`；只有读取仓库内模板文件时才需要先 `actions/checkout`。
- 不使用 `runs.using: node20`（这是 JavaScript Action 的写法），因此不受 GitHub 对 JS Action 打包规范的限制，但仍需提交 `dist/`。

### 2.3 竞品与差异化

- `guangzhengli/wecom-notification-action`（调研时 7 stars）：只支持文本/文件提醒，没有模板卡片、事件预设、消息体模板。
- 其他搜索结果没有成熟的「Composite Action + 完整 WeCom 模板/卡片」方案。
- 差异化：**零配置事件卡片 + 三级定制 + 模板循环/条件 + 可视化构建器 + 本地 dry-run**。

### 2.4 现有 `webcom.html` 的结论

现有单文件构建器已覆盖 7 种类型（text / markdown / markdown_v2 / news / image / card_text / card_news），布局和字段较完整，可直接作为新版构建器基础。必须修复：

- markdown 默认内容 `'\\n'` 会生成字面 `\n`；
- `desc_color`、`aspect_ratio`、`type` 用字符串绑定，导出的 JSON 是 `"0"` / `"1.5"`；
- `image.md5` 是占位文本，不是真实 MD5；
- 没有校验（字节数、必填、列表上限、URL、比例）；
- `card_action` 缺失时静默回退到 `https://example.com`；
- 图片上传依赖外部 `/upload` 后端；
- 不支持 `file` / `voice` / `media_id`，也不支持卡片的 type 2（小程序）。

---

## 3. 使用方式（对外 API 草案）

### 3.1 零配置

```yaml
- uses: <owner>/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
```

按事件自动选预设；例如 `push` 发一张提交卡片，`pull_request` 发 PR 卡片，`release` 发 Release 卡片，未知事件发通用 markdown。无需 checkout（不使用模板文件时）。

### 3.2 选预设 + 深合并

```yaml
- uses: <owner>/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: pull_request
    overrides: |
      template_card:
        source:
          desc: 我的机器人
          desc_color: 3
```

### 3.3 简单卡片（Action YAML 内完成 Title / subtitle / Info / Card）

```yaml
- uses: <owner>/wecom-notifier@v1
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
    image-url: https://example.com/cover.png   # 有图时自动使用 news_notice
```

### 3.4 内联完整消息体

```yaml
- uses: <owner>/wecom-notifier@v1
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

### 3.5 仓库内模板文件（推荐做复杂定制）

默认目录：`.github/wecom-notify/`。按当前事件自动查找，一个事件一个文件：

```text
.github/wecom-notify/
├── wecom-push.yml          # 只负责 push
├── wecom-pull_request.yml  # 只负责 pull_request
├── wecom-release.yml
└── wecom-default.yml       # 可选兜底（或 default.yml）
```

命名支持 `<event>.yml`、`<event>.yaml`、`*-<event>.yml`、`*-<event>.yaml`（如 `wecom-push.yml`）；同一事件匹配多个文件会报错。`default.yml` / `_default.yml` 作为无事件文件时的兜底。也可显式指定单个文件：

```yaml
- uses: actions/checkout@v4        # 读取模板文件必须先 checkout
- uses: <owner>/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    template: .github/wecom-notify/push.yml
```

`template-dir` 可改目录（默认 `.github/wecom-notify`；传 `''` 禁用自动查找）。事件文件可以是完整消息，也可以只写 `overrides`（此时自动继承当前事件的预设），这样共享字段改动时不必复制整张卡片。

模板可以是完整消息：

```yaml
msgtype: template_card
template_card:
  card_type: text_notice
  source:
    desc: GitHub
    desc_color: 0
  main_title:
    title: "📦 {{ repo.name }}"
    desc: "{{ actor }} · {{ ref_name }}"
  emphasis_content:
    $if: commit_count
    title: "{{ commit_count }}"
    desc: 次提交
  quote_area:
    $if: "{{ commits.length }}"
    title: 最近提交
    quote_text:
      $each: commits
      $limit: 3
      $item: "- {{ item.message | firstLine | truncate: 40 }}"
      $join: "\n"
  horizontal_content_list:
    $each: commits
    $limit: 4
    $item:
      keyname: "{{ item.author.name | truncate: 5 }}"
      value: "{{ item.message | firstLine | truncate: 26 }}"
  jump_list:
    - type: 1
      title: 查看对比
      url: "{{ compare_url }}"
  card_action:
    type: 1
    url: "{{ compare_url }}"
```

也可以是「继承预设 + 覆盖」：

```yaml
extends: push
overrides:
  template_card:
    source:
      desc: 我的仓库
```

### 3.6 Dry-run

```yaml
- uses: <owner>/wecom-notifier@v1
  with:
    dry-run: "true"
    preset: card
    title: 测试
```

不需要真实 webhook；渲染结果打印到日志并写入 `payload` 输出。适合在 PR/CI 中校验模板。

---

## 4. 消息构建模型与优先级

```
payload（内联） ─┐
template（文件） ─┼─> base message ─> overrides 深合并 ─> 扁平输入 ─> 渲染
preset / auto ───┘                                                   │
                                                                     v
                                          剪空 ─> 类型归一 ─> 校验/截断 ─> 发送
```

### 4.1 基础消息来源优先级

1. `payload` 非空 → 作为基础消息/配置；忽略自动目录，若同时显式设置 `template` 则报错，避免二义性。
2. 否则 `template` / `template-dir`：
   - `template` 显式文件优先；文件不存在 → 报错。
   - 否则在 `template-dir`（默认 `.github/wecom-notify`）按当前事件查找 `<event>.yml|yaml` 或 `*-<event>.yml|yaml`（如 `wecom-push.yml`）；多个匹配 → 报错；无匹配则找 `default.yml` / `_default.yml`；都没有则回落到预设。
   - `template-dir: ''` → 禁用自动查找。
3. 否则 `preset`（默认 `auto`）。`preset: none` 表示无基础消息，必须配合 `payload`/模板，否则报错。
4. 若模板/配置中有 `extends`，用 `extends` 对应的预设作为基础消息；`extends: auto` 使用当前事件。
5. 模板/配置中的 `overrides` 先应用，再应用 Action 输入 `overrides`。
6. 扁平输入只在基础消息来自 `preset: text` / `preset: markdown` / `preset: card`（或模板 `extends: text|markdown|card`）时生效；其他情况忽略并给出 warning。

### 4.2 配置文档两种形态

- **纯消息**：顶层有 `msgtype`，整个对象就是企业微信消息。
- **配置包装**：顶层没有 `msgtype`，只允许 `extends`、`vars`、`overrides` 三个键。

```yaml
extends: auto | push | pull_request | issues | issue_comment | release | workflow_run | star | fork | create | delete | generic | text | markdown | card | none
vars:
  env: production
  icon: https://example.com/icon.png
overrides:
  ...
```

- `msgtype` 与 `extends`/`vars`/`overrides` 同时出现 → 报错。
- 纯消息未提供 `msgtype` → 报错。
- 事件文件只写 `overrides` 时，默认 `extends: auto`（继承当前事件预设）；显式 `extends: none` 表示从空消息开始。
- `vars`：模板文件里的变量对象；Action 的 `vars` 输入会覆盖同名键。`vars` 不会被再次渲染（避免递归），但值可以参与 `{{ vars.x }}`。
- 文件内 `overrides` 与输入 `overrides` 都做深合并；数组整体替换；`null` 删除键；`0`/`false` 保留。

### 4.3 扁平输入（`preset: card`）

| 输入 | 映射 | 默认 |
| --- | --- | --- |
| `title` | `template_card.main_title.title` | `repo.full_name` |
| `subtitle` | `main_title.desc` | 空 |
| `content` | `text_notice.sub_title_text`；`news_notice.quote_area.quote_text` | 空 |
| `info` | `horizontal_content_list`（最多 6；逐行 `key: value`，也接受 JSON 数组） | 空 |
| `links` | `jump_list`（最多 3；逐行 `title \| url`，也接受 JSON 数组） | 空 |
| `link-url` | `card_action.url` | 事件详情 URL → 仓库 URL |
| `link-title` | 无 `links` 时生成一条 jump link 的标题 | `查看详情` |
| `image-url` | 存在则 `card_type: news_notice` + `card_image.url`；否则 `text_notice` | 空 |
| `source` | `source.desc` | `GitHub` |
| `source-color` | `source.desc_color` | `0` |
| `source-icon` | `source.icon_url` | 空（避免默认图裂） |

- `info` / `links` 的键值会做字符串渲染（支持 `{{ }}`），但不会自动截断；超过推荐长度给 warning。
- 卡片 `title` 为空且 `content` 也为空时，校验失败（`text_notice` 至少要有标题或副文本）。
- 有 `image-url` 时要求 `title` 非空（默认会回退到 `repo.full_name`）。

### 4.4 输入/输出总表

**输入**

| 名称 | 默认 | 说明 |
| --- | --- | --- |
| `webhook` | 必填（dry-run 时可选） | 完整 webhook URL 或仅 key；建议 `${{ secrets.WECOM_WEBHOOK }}` |
| `preset` | `auto` | `auto` / 事件名 / `text` / `markdown` / `card` / `none` |
| `payload` | `''` | 内联 YAML/JSON 消息或配置 |
| `template` | `''` | 显式模板文件；优先于 `template-dir`；不存在则报错 |
| `template-dir` | `.github/wecom-notify` | 按事件自动查找 `<event>.yml` / `*-<event>.yml`；`''` 禁用 |
| `overrides` | `''` | YAML/JSON 深合并补丁 |
| `vars` | `''` | YAML/JSON 变量对象 |
| `title` / `subtitle` / `content` / `info` / `links` / `link-url` / `link-title` / `image-url` / `source` / `source-icon` / `source-color` | 见 §4.3 | 简单卡片 |
| `dry-run` | `false` | 只渲染不发送 |
| `fail-on-error` | `true` | 校验/发送失败时是否让 step 失败 |
| `auto-truncate` | `true` | 自动截断 text/markdown/news 的硬字节限制 |
| `timeout` | `10` | 单次请求超时（秒），1–60 |
| `retries` | `2` | 网络错误/5xx/45009 的重试次数（0–5） |
| `api-base` | `https://qyapi.weixin.qq.com` | 企业网关/测试用；webhook 为完整 URL 时忽略 |
| `debug` | `false` | 输出不含密钥的调试信息 |

**输出**

| 名称 | 说明 |
| --- | --- |
| `msgtype` | 最终消息类型 |
| `payload` | 渲染后的 JSON（≤64KB，超出则截断标记） |
| `errcode` | 企业微信返回码；dry-run/失败时为空 |
| `errmsg` | 企业微信返回信息 |

---

## 5. 模板语法（核心设计）

### 5.1 文件格式

- YAML 1.2 或 JSON，UTF-8（允许 BOM）；推荐 YAML（多行文本友好）。
- 模板文件上限 5MB；`payload` / `overrides` / `vars` 各上限 5MB / 5MB / 64KB。
- 不允许自定义标签、不允许执行代码；YAML 别名数量上限 100。
- 模板路径解析到 `GITHUB_WORKSPACE`，拒绝逃逸到 workspace 之外的路径；本地 CLI 同样限制（可显式配置 workspace）。

### 5.2 插值

- `{{ 表达式 }}` 在字符串中求值；支持一个字符串里多个表达式。
- **整串表达式保留类型**：`"{{ vars.count }}"` 可以返回数字/布尔/数组/对象；嵌入文本时统一转字符串（对象/数组用 JSON）。
- 未定义路径求值为 `undefined`，最终作为空值被剪掉；不会抛异常，便于 `$if` 判断。
- 转义：`\{{` 输出字面量 `{{`。
- 不执行任意函数；只能用内置过滤器。

### 5.3 表达式

支持：

```text
路径：repo.name / event.pull_request.number / commits[0].message / github.run_id
字面量："text" / 123 / 1.5 / true / false / null
比较：== != > < >= <=
逻辑：&& || !（也接受 and / or / not）
括号：(a || b) && c
过滤器：{{ name | default: "unknown" | truncate: 20 }}
```

- 属性访问支持 `length`（数组/字符串）；数组支持 `[n]` 索引。
- 真值规则：`null` / `undefined` / `false` / `0` / `""` / `[]` / `{}` 为假，其余为真。
- 比较：数字与数字按数值；字符串按字典序；不做隐式字符串→数字转换（避免意外）。

### 5.4 指令

| 指令 | 作用 | 约束 |
| --- | --- | --- |
| `$if` | 条件为假时删除该对象/数组项 | 表达式字符串；可与普通字段共存 |
| `$each` | 遍历数组 | 值是路径/表达式/字面量数组；必须是数组 |
| `$item` | 每项模板 | 必须与 `$each` 同对象 |
| `$as` | 循环变量名（默认 `item`） | 合法标识符 |
| `$limit` | 最多渲染前 N 项 | 1–100；默认 100，超出部分跳过并 warning |
| `$join` | 把每项结果用分隔符拼成字符串 | 仅与 `$each` 同用；每项必须是标量 |
| `$prefix` / `$suffix` | 拼接前缀/后缀 | 仅与 `$join` 同用 |

示例（markdown 循环）：

```yaml
msgtype: markdown
markdown:
  content:
    $each: commits
    $limit: 5
    $item: "- [{{ item.short_sha }}]({{ item.url }}) {{ item.message | firstLine | truncate: 60 }}"
    $prefix: "### 🚀 {{ repo.full_name }}\n\n"
    $join: "\n"
    $suffix: "\n\n[查看对比]({{ compare_url }})"
```

- `$if` 为假 → 整个节点删除（对象键或数组项）；值可写裸表达式（如 `commit_count`），也可写 `{{ ... }}`，两者等价。
- `$if` 与 `$each` 不要放在同一对象；需要「条件循环」时用 `$each` 的源数组本身过滤，或在 `$item` 子对象上写 `$if`。
- `$each` 无 `$join` → 输出数组；有 `$join` → 输出字符串。
- 嵌套 `$each` 用 `$as` 区分变量；未指定时内层 `item` 会遮蔽外层。
- 未知 `$` 指令、`$item` 缺失、`$join` 用在对象项上等 → 渲染错误，附 JSON 路径。

### 5.5 过滤器

| 过滤器 | 参数 | 说明 |
| --- | --- | --- |
| `default` | 值 | 空值（null/undefined/""）时使用默认值 |
| `truncate` | 字符数 | 按 Unicode 字符截断，追加 `…` |
| `truncateBytes` | 字节数 | 按 UTF-8 字节截断，不拆多字节 |
| `firstLine` | — | 取第一行 |
| `oneLine` | — | 所有空白折叠为单空格 |
| `upper` / `lower` | — | 大小写 |
| `replace` | 旧, 新 | 全部替换 |
| `join` | 分隔符 | 数组拼接 |
| `take` / `skip` | N | 数组切片 |
| `first` / `last` | — | 数组首/末项 |
| `length` | — | 数组/字符串长度 |
| `json` | — | JSON 序列化 |
| `urlencode` | — | `encodeURIComponent` |
| `escapeMd` | — | 转义 Markdown 特殊字符 |

### 5.6 上下文

模板只能访问以下内容（**不包含 secrets / token / env / inputs**）：

| 字段 | 说明 |
| --- | --- |
| `event` | 原始 GitHub 事件 payload（只读） |
| `event_name` | 事件名，如 `push` |
| `event_action` | `event.action`，没有则 `null` |
| `actor` | 触发者 login |
| `repo.*` | `owner`、`name`、`full_name`、`html_url`、`default_branch`、`private`、`description` |
| `github.*` | 安全的 GitHub 元数据：`repository`、`repository_owner`、`actor`、`triggering_actor`、`sha`、`ref`、`ref_name`、`workflow`、`run_id`、`run_number`、`run_attempt`、`server_url`、`api_url`、`workspace`、`action_path` |
| `ref` / `ref_name` / `ref_type` | 同 GitHub 环境变量；无则 `null` |
| `sha` / `short_sha` | 当前提交 |
| `workflow` / `run_id` / `run_number` / `run_attempt` | 工作流信息 |
| `run_url` | `{server_url}/{repo}/actions/runs/{run_id}` |
| `now` / `now_unix` | 当前 UTC ISO 时间 / Unix 秒 |
| `vars.*` | 模板文件 + 输入合并后的变量 |
| `commits` | `event.commits` 的增强副本：每项补 `short_sha`、`first_line`、`one_line` |
| `commit_count` | `commits.length` |
| `compare_url` | `event.compare`，或由 `before...after` 推导；无则 `commit/{sha}` |
| `detail_url` | 事件最佳详情 URL（PR/issue/release/run/compare…），兜底仓库 URL |
| `pr` / `issue` / `comment` / `release` / `workflow_run` | 对应 payload 子对象的别名，便于简写 |

- `event.*` 保留 GitHub 原始结构；`repo`、`github` 从 payload/环境变量归一化。
- 不会把 `process.env` 展开到上下文；`vars` 是唯一自定义数据入口。
- 事件内容可能包含用户可控文本（标题、正文、评论）；模板作者应使用 `truncate` / `escapeMd`，不要直接拼进危险的 Markdown/HTML。

### 5.7 渲染安全与上限

- 自研表达式解析器，不使用 `eval` / `new Function`。
- 渲染深度 ≤20，节点数 ≤10000，单次 `$each` ≤100 项；超出直接报错。
- 剪空：递归删除 `undefined` / `null` / `''` / 空数组 / 空对象；保留 `0` / `false`。
- 深合并禁止 `__proto__` / `constructor` / `prototype`，防止原型污染。
- 模板不能改变 webhook、不能读文件系统（除模板文件本身）、不能发起请求。

---

## 6. 内置事件预设

`preset: auto` 按 `GITHUB_EVENT_NAME` 选择；未知事件使用 `generic`。预设都用 `text_notice`（无图场景），字段经过推荐长度裁剪，保证不超推荐值。

| 事件 | 卡片主要内容 |
| --- | --- |
| `push` | 仓库 + 分支；`emphasis` 提交数；`sub_title_text` 最近 3 条提交（不占用 quote）；horizontal 分支/提交/作者；jump 对比/仓库；action=compare_url。分支删除显示「分支已删除」。 |
| `pull_request` | `#{number} {title}`；desc `{author} · {base} ← {head}`；emphasis `+add/-del`；`sub_title_text` 正文摘要（不占用 quote）；horizontal 状态/变更/文件；action=PR URL。merged/closed/opened 不同标题与颜色。 |
| `issues` | `#{number} {title}`；desc `{author} · {action}`；quote 正文摘要；horizontal 状态/标签/分配人；action=issue URL。 |
| `issue_comment` | 「💬 新评论」；desc `#{issue.number} {issue.title}`；quote 评论摘要；action=评论 URL。 |
| `release` | 「🏷️ {tag}」；desc release name；quote release notes 摘要；horizontal 预发布/资源数/作者；action=release URL。 |
| `workflow_run` | 「{✅/❌/…} {workflow.name} #{run_number}」；desc 分支/事件；emphasis conclusion；horizontal 工作流/分支/触发；action=run URL。 |
| `star` | 「⭐ 新的 Star」；desc `{sender}`；emphasis star 数；`sub_title_text` 仓库描述（不占用 quote）；action=repo URL。 |
| `fork` | 「🍴 仓库被 Fork」；desc `{sender}`；quote 新仓库名；action=fork URL。 |
| `create` / `delete` | 「🌿 新建 / 🗑️ 删除 {ref_type}」；desc `{ref}`；action=仓库（删除时用仓库 URL，避免 404）。 |
| `workflow_dispatch` / `schedule` / 未知 | 通用 markdown：事件名、仓库、触发者、运行链接。 |
| `text` | 纯文本 `content`（必填）。 |
| `markdown` | 原生 markdown `content`（必填）。 |
| `card` | §4.3 的简单卡片。 |
| `none` | 空基础消息（仅配合 payload/模板）。 |

- 预设生成的 `card_action` 永远不为空；不使用 `example.com` 回退。
- 预设标题内部会 `fit` 到推荐长度（26/30/112 等），并在必要时加 `…`；custom payload 不静默裁剪，只 warning。
- `pull_request` 来自 fork 时 `secrets` 不可用，这是 GitHub 限制，文档会给出 `pull_request_target` / `workflow_run` 方案与安全警告。

---

## 7. 校验、错误与发送

### 7.1 校验

分三层：

1. **结构**：`msgtype` 合法；对应消息对象存在；`template_card.card_type` 合法；必填字段齐全；类型正确（Int/Float/String/Array/Object）。
2. **硬限制**：text/markdown/markdown_v2 字节数；image 解码后 ≤2MB、JPG/PNG 魔数；news 1–8 条、URL 必填；列表数量（horizontal ≤6、jump ≤3、vertical ≤4）；`aspect_ratio` 区间；`desc_color` 0–3；type 枚举。
3. **建议**：卡片推荐字数、URL 是否 https、图标 URL、`quote_area` 与 `emphasis_content` 同时使用、markdown_v2 中出现颜色标签等 → warning。

- **数值归一**：`desc_color`、`aspect_ratio`、各类 `type` 若为数字字符串（如 `"2"`）自动转数字；转不了报错。兼容 YAML/构建器常见写法。
- **图片**：`base64` 接受 data URL 前缀并剥离；自动计算 MD5，若用户提供且不一致 → 报错；缺失则补齐。
- **截断**：仅对 text/markdown/markdown_v2 的 `content`，以及 news 的 `title`/`description` 硬字节限制做自动截断（`auto-truncate: true`），保留合法 UTF-8 并追加 `…`；列表数量超限不自动丢弃，直接报错。
- **空值**：剪空后 `content` 为空 → `93017` 类错误；`text_notice` 的 title 和 sub_title_text 都为空 → 报错；`news_notice` 缺 title/card_image/card_action → 报错。
- 校验失败**绝不发送**；错误信息带 `[E_XXX]` 代码 + JSON 路径 + 修复建议。
- 支持 `file` / `voice` 的**透传**（只校验 `media_id` 非空），但不提供上传；媒体需与同一 webhook 绑定且在 3 天有效期内。

### 7.2 发送

- Node `fetch`，`Content-Type: application/json`，`AbortController` 超时。
- 成功判定：HTTP 2xx 且 `errcode === 0`；否则读 JSON/文本，映射错误码。
- 重试：网络错误、超时、HTTP 5xx、`45009`；指数退避（1s、2s、4s…，最多 5 次），非幂等可能重复，文档说明。
- 不重试：93000/93001/93004/93006/93008/93017/93018/45008/40058 等业务错误。
- `retries: 0` 时只发一次。
- `api-base` 仅用于完整 URL 缺省时拼接或自建网关；完整 webhook URL 原样使用。
- webhook 支持两种写法：完整 `https://.../send?key=...`，或只传 key（自动拼接 `api-base`）。

### 7.3 安全

- 启动即 `::add-mask::` webhook 与 key；所有错误/调试输出经过 `redact()`，把 URL/key 替换为 `***`。
- 不打印 `WECOM_INPUTS`、`vars`、`process.env`；`debug` 只打印事件名、消息类型、字节数、配置键。
- 模板上下文不含 `secrets` / `github.token` / `inputs` / `env`；即使模板来自被篡改的 PR 分支，也只能读取事件与显式变量。
- 模板路径限制在 workspace；文件大小/迭代/深度上限。
- `fail-on-error: false` 时只 warning，不把无效消息发出去。
- 文档明确：不要把不可信输入拼进 `webhook`；不要用 `pull_request_target` + checkout PR 代码 + secrets 的组合。

### 7.4 日志与输出

- 默认日志：事件、预设、消息类型、字节数、发送结果；不打印消息正文。
- 警告：`::warning title=WeCom Notifier::[W_...] ...`；错误：`::error ...`。
- `GITHUB_STEP_SUMMARY` 写一张小表：事件、类型、大小、状态；不含正文和 webhook。
- `payload` 输出超过 64KB 时写截断标记并 warning（避免 GitHub output 限制）。
- dry-run 打印渲染后的 JSON；如果 >16KB，打印摘要并提示用 `payload` 输出/本地 CLI 查看完整内容。
- 客户端版本提示：markdown_v2 在旧客户端显示纯文本；这是预期行为，不算错误。

---

## 8. 仓库结构

```text
.
├── action.yml                     # Composite Action 入口
├── dist/
│   └── index.mjs                  # esbuild 打包产物（提交到仓库）
├── src/
│   ├── index.mjs                  # 编排：输入→上下文→配置→渲染→校验→发送
│   ├── cli.mjs                    # 本地 CLI
│   ├── inputs.mjs                 # 输入默认值/规范化
│   ├── context.mjs                # 事件与安全上下文构建
│   ├── config.mjs                 # payload/template/vars/overrides 解析
│   ├── template/
│   │   ├── expression.mjs         # 词法/语法/求值
│   │   ├── filters.mjs
│   │   └── render.mjs             # 插值/$if/$each
│   ├── presets/
│   │   ├── index.mjs
│   │   ├── push.mjs
│   │   ├── pull_request.mjs
│   │   ├── issues.mjs
│   │   ├── issue_comment.mjs
│   │   ├── release.mjs
│   │   ├── workflow_run.mjs
│   │   ├── star.mjs
│   │   ├── fork.mjs
│   │   ├── create_delete.mjs
│   │   ├── card.mjs
│   │   ├── text_markdown.mjs
│   │   └── generic.mjs
│   ├── message/
│   │   ├── normalize.mjs          # 数值/图片/剪空
│   │   ├── validate.mjs           # 结构与限制
│   │   └── truncate.mjs
│   ├── send.mjs
│   ├── log.mjs
│   ├── errors.mjs
│   └── util.mjs
├── scripts/
│   ├── build.mjs                  # esbuild bundle
│   └── check-dist.mjs             # 重建并 diff，CI 用
├── test/
│   ├── fixtures/events/*.json     # 手写最小事件 payload
│   ├── fixtures/templates/*.yml
│   ├── *.test.mjs                 # node --test
│   └── server.mjs                 # 本地模拟 qyapi
├── docs/
│   ├── index.html                 # 升级后的构建器（原 webcom.html）
│   ├── configuration.md
│   ├── templates.md
│   ├── events.md
│   ├── wecom.md
│   ├── troubleshooting.md
│   ├── development.md
│   └── .nojekyll
├── examples/
│   ├── zero-config.yml
│   ├── push-card.yml
│   ├── custom-card.yml
│   ├── markdown.yml
│   ├── template-file.yml
│   └── templates/push-card.yml
├── .github/
│   ├── workflows/ci.yml
│   ├── workflows/release.yml
│   ├── ISSUE_TEMPLATE/
│   └── dependabot.yml
├── README.md
├── README.en.md                   # 可选，见待确认
├── DESIGN.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── package.json
├── package-lock.json
├── .gitignore
├── .gitattributes
├── .editorconfig
└── webcom.html                    # 迁移前保留；确认后移入 docs/ 并升级
```

- `dist/` 提交是 Composite Action 免安装运行的关键；CI 校验「源码构建结果 == dist」。
- `node_modules/` 不入库；`npm ci` 后可复现构建。
- `.research/`、`.env` 不入库（`.gitignore`）。

---

## 9. 实现要点

### 9.1 运行时

- Node **≥18**（hosted runner 均满足；self-hosted 需预装，action 启动时检查并给出明确错误）。
- 源码 ESM；构建期依赖：`yaml@2.9.x`、`esbuild@0.28.x`（锁定版本 + lockfile + Dependabot）。
- `dist/index.mjs` 用 esbuild `--bundle --platform=node --format=esm --target=node18` 生成；不 minify，便于审计。
- 本地 CLI 与 Action 共用同一套模块；不复制逻辑。

### 9.2 action.yml 草案

```yaml
name: WeCom Notifier
description: Send GitHub repository events to a WeCom group robot with event presets, custom cards, and YAML templates.
author: <owner>
branding:
  icon: message-square
  color: green
inputs:
  webhook:
    description: WeCom group robot webhook URL (or key). Use a secret.
    required: false
  # ... 其余输入
outputs:
  msgtype:
    description: Final WeCom message type
    value: ${{ steps.notify.outputs.msgtype }}
  payload:
    description: Rendered JSON payload (truncated at 64KB)
    value: ${{ steps.notify.outputs.payload }}
  errcode:
    description: WeCom errcode
    value: ${{ steps.notify.outputs.errcode }}
  errmsg:
    description: WeCom errmsg
    value: ${{ steps.notify.outputs.errmsg }}
runs:
  using: composite
  steps:
    - id: notify
      shell: bash
      env:
        WECOM_INPUTS: ${{ toJSON(inputs) }}
        WECOM_ACTION_PATH: ${{ github.action_path }}
      run: |
        set -euo pipefail
        if ! command -v node >/dev/null 2>&1; then
          echo "::error::Node.js 18+ is required to run WeCom Notifier."
          exit 1
        fi
        major="$(node -p 'process.versions.node.split(".")[0]')"
        if [ "$major" -lt 18 ]; then
          echo "::error::Node.js 18+ is required (found $(node -v))."
          exit 1
        fi
        node "$WECOM_ACTION_PATH/dist/index.mjs"
```

- `webhook` 不设 `required: true`，以便 dry-run；运行时校验。
- 不把 webhook 写进 `outputs`，避免二次泄漏。
- 复合步骤只做 Node 检查与启动；所有逻辑在 Node 内，跨平台一致。

### 9.3 测试

- 单元：表达式/过滤器/指令/剪空/深合并/原型污染拒绝/截断/校验/预设快照/错误脱敏。
- 集成：本地 HTTP server 模拟 `qyapi`：
  - 成功 `errcode: 0`；
  - 93000 不重试；
  - 45009 重试后成功；
  - 500/超时重试；
  - 断言请求头、body、重试次数；dry-run 不请求。
- Action 级：CI 中 `uses: ./` + `dry-run: true`，覆盖零配置、`preset: card`、模板文件三种路径。
- `node --test`，无第三方测试框架；Node 20/22 矩阵；ubuntu + windows + macOS 至少各一。
- `actionlint`（Docker）校验 action.yml/workflows。
- `scripts/check-dist.mjs` 在 CI 重建并 `git diff --exit-code dist`。

### 9.4 本地运行

```bash
npm ci
npm run build
node dist/index.mjs --dry-run \
  --event test/fixtures/events/push.json \
  --event-name push
# 或读取 .env（Node 自带 --env-file，不经过 action）：
node --env-file=.env dist/index.mjs --event ... --event-name push
```

CLI 支持 `--dry-run`、`--event`、`--event-name`、`--inputs`、`--template`、`--payload`、`--webhook`、`--api-base`、`--print-context`、`--help`。不读取 `.env`，由用户/Node 处理。

### 9.5 兼容性/发布

- 支持 ubuntu / windows / macos 的 GitHub hosted runner；bash 由 runner 提供。
- 版本：`v1.0.0` + 浮动 `v1` 标签；README 建议生产用完整版本或 SHA。
- 发布流程：测试 → `npm run build` → 提交 dist → 打 tag → GitHub Release → Marketplace；浮动 tag 用脚本更新。
- 许可证：MIT（版权人待确认）。

---

## 10. 构建器升级（`webcom.html` → `docs/index.html`）

保留现有双栏风格和零依赖单文件，做以下升级：

1. **修复**：
   - markdown 默认值、数字字段类型（`desc_color` / `aspect_ratio` / `type` 用 `Number`）、真实 MD5（内嵌 MIT 许可的紧凑实现）、移除 `example.com` 回退。
2. **校验面板**：
   - 实时显示 text/markdown 字节数（2048/4096）；
   - 必填项、列表上限、URL 合法性、`aspect_ratio` 区间、卡片推荐字数；
   - 错误/警告分级，点击定位字段。
3. **模板/变量**：
   - 侧栏列出上下文变量（`repo.full_name`、`event_name`、`commits`…）和过滤器，点击插入到焦点输入；
   - 可切换「静态消息 / 模板」，模板模式下用示例 push/PR 数据预览；
   - 一键复制 `{{ ... }}` / `$each` 片段。
4. **导出**：
   - JSON 消息体（复制/下载）；
   - Action 步骤 YAML（`preset: card` 或 `payload: |`）；
   - 模板文件内容（JSON 即合法 YAML，可直接保存为 `.yml`）。
5. **图片**：
   - `image` 消息：本地选图 → base64 + MD5 + 大小/类型校验（≤2MB，JPG/PNG）；
   - 卡片图：直接填公网 URL；保留可选上传服务地址（默认关，不依赖后端）。
6. **文档/品牌**：
   - 标题改为 WeCom Notifier Builder，链接回仓库；
   - 说明「卡片图片必须公网可访问」「webhook 不要贴到公开页面」。
7. **托管**：
   - 放在 `docs/index.html`，GitHub Pages 源设为 `docs/`，`.nojekyll`；
   - README 给在线地址；本地双击也能用。
8. **保持**：
   - 零构建、零 CDN、无外部字体/脚本；离线可用；
   - 现有类型与字段不减少（只增加校验和导出）。

---

## 11. 文档与示例

- `README.md`（中文为主）：
  - 特性、消息截图（实现后补）、30 秒快速开始、三级定制、输入/输出表、安全、兼容性、开发。
- `README.en.md`（可选）：英文简介 + 关键用法。
- `docs/configuration.md`：全部输入/输出/优先级/示例。
- `docs/templates.md`：语法、上下文、过滤器、指令、事件示例、限制。
- `docs/events.md`：每个预设的字段映射和截图。
- `docs/wecom.md`：企业微信消息类型、限制、错误码（中文整理 + 官方链接）。
- `docs/troubleshooting.md`：93000/45009、fork secret、图片 URL、markdown_v2 旧客户端、Windows 32KB、重试重复。
- `docs/development.md`：构建、测试、dist 校验、发布、版本。
- `examples/`：可直接复制到 `.github/workflows/` 的示例。
- `SECURITY.md`：报告渠道、webhook 凭证、模板沙箱、不可信 PR 内容。
- `CONTRIBUTING.md`：环境、测试、提交约定、dist 规则。
- `CHANGELOG.md`：Keep a Changelog。

---

## 12. 里程碑（实现顺序）

1. **M1 核心**：仓库脚手架、`action.yml`、输入/上下文/配置/模板/表达式/校验/发送、单元测试。
2. **M2 预设**：10 个事件预设 + `text`/`markdown`/`card`/`generic`、fixtures、快照测试；本地 HTTP 集成测试。
3. **M3 打包与 CI**：esbuild + `dist`、`check-dist`、actionlint、`uses: ./` dry-run、跨平台矩阵。
4. **M4 构建器**：迁移/升级 `docs/index.html`、MD5、校验、导出、浏览器验证。
5. **M5 文档与发布**：README/docs/examples、MIT、SECURITY、CHANGELOG、tag v1.0.0、Marketplace 准备。

预计源码 ~2.0–2.5k 行（不含 dist），测试 ~1.0k 行，构建器 ~1.2k 行，文档 ~1.5k 行。

---

## 13. 风险与对策

| 风险 | 对策 |
| --- | --- |
| self-hosted runner 没有 Node 18+ | 启动检查 + 明确报错；文档写前置条件；不使用 Docker（Composite 要求） |
| Windows 单环境变量 ~32KB | 大消息走 `template` 文件；文档明确；`payload` 仅适合中小内容 |
| 卡片图片不是公网 URL | 校验 warning；文档说明 GitHub artifact/私有链接不可用；示例用 raw/CDN |
| 重试导致重复消息 | 文档说明；默认 2 次；可设 `retries: 0`；45009 才重试业务错误 |
| 20 条/分钟 | 文档 + 45009 退避；不做跨 job 队列 |
| 模板来自不可信 PR 分支 | 上下文不含 secrets/token；路径限制；大小/迭代上限；文档警告 |
| 企业微信推荐长度不是硬限制 | 只 warning；预设内部裁剪；不擅自截断用户文本 |
| YAML 依赖供应链 | lockfile + 固定版本 + Dependabot + `npm ci`；dist 审计 |
| `template_card` 字段随官方更新 | 未知字段 warning 而非 error；文档标注官方更新日期 |
| 构建器与 Action 校验逻辑漂移 | 以 `docs/wecom.md` 的约束表为单一来源；构建器实现同表；测试覆盖关键限制 |
| fork PR 无 secrets | 文档给 `pull_request_target` / `workflow_run` 方案与安全注意 |

---

## 14. 确认记录与剩余信息

> 已确认：1（定制模型）、3（预设范围）、4（构建器）、5（运行时）、6（仓库信息）。
> 第 2 项按「一事件一文件」调整：默认目录 `.github/wecom-notify/`，`<event>.yml` 或 `*-<event>.yml`（如 `wecom-push.yml`），`default.yml` 兜底；`template` 显式指定单文件，`template-dir` 可改/禁用。

1. **定制模型**：采用「自动预设 + `overrides` 深合并 + `preset: card` 扁平字段 + 内联 `payload`/仓库模板（`{{ }}` + `$if`/`$each`）」的组合；模板 YAML/JSON 都支持；不引入 Handlebars/Mustache。**已确认。**
2. **模板组织**：一事件一文件，避免所有消息体挤在一个 YAML 里；目录与文件名规则见 §3.5 / §4.1。**已确认（按你的建议调整）。**
3. **预设范围**：`push`、`pull_request`、`issues`、`issue_comment`、`release`、`workflow_run`、`star`、`fork`、`create`、`delete` + `text`/`markdown`/`card`/`generic`；`file`/`voice` 仅透传 `media_id`，不做上传。**已确认。**
4. **构建器**：把 `webcom.html` 迁移为 `docs/index.html` 并升级（修数值/MD5/校验/导出/模板变量），支持导出 JSON/YAML 文本直接替换对应事件模板；GitHub Pages 从 `docs/` 发布；原文件在首次提交中保留历史。**已确认。**
5. **运行时**：Composite Action + 提交 `dist/index.mjs`（bundle `yaml`），要求 runner Node ≥18；不引入 Docker/运行时安装。**已确认。**
6. **仓库信息**：GitHub ID `teriyakiushi`；MIT，版权人 `teriyakiushi`；中文 `README.md` + 英文 `README.en.md`；先 `git init` 本地跑通，不立即发布。**已确认。**

---

## 附录 A：零配置 push 卡片示意

```json
{
  "msgtype": "template_card",
  "template_card": {
    "card_type": "text_notice",
    "source": { "desc": "GitHub", "desc_color": 0 },
    "main_title": {
      "title": "📦 wecom-notifier",
      "desc": "octocat 推送到 main"
    },
    "emphasis_content": { "title": "3", "desc": "次提交" },
    "sub_title_text": "最近提交：\n- feat: 增加卡片模板\n- fix: 数值类型\n- docs: 补充示例",
    "horizontal_content_list": [
      { "keyname": "分支", "value": "main" },
      { "keyname": "提交", "value": "a1b2c3d" },
      { "keyname": "作者", "value": "octocat" }
    ],
    "jump_list": [
      { "type": 1, "title": "查看对比", "url": "https://github.com/o/r/compare/a...b" },
      { "type": 1, "title": "查看仓库", "url": "https://github.com/o/r" }
    ],
    "card_action": { "type": 1, "url": "https://github.com/o/r/compare/a...b" }
  }
}
```

## 附录 B：官方文档索引

- 群机器人配置说明：https://developer.work.weixin.qq.com/document/path/91770
- 全局错误码：https://developer.work.weixin.qq.com/document/path/90313
- 上传临时素材（media_id）：https://developer.work.weixin.qq.com/document/path/91770（同页 upload_media 章节）
- GitHub Composite Action：https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action
- GitHub Actions 变量：https://docs.github.com/en/actions/reference/variables-reference
- GitHub Events：https://docs.github.com/en/actions/reference/events-that-trigger-workflows
