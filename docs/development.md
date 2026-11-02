# 开发

## 1. 环境

- Node.js **≥18**（CI 用 20/22；Action 运行环境也要求 18+）
- npm 10+
- Git
- 不需要企业微信账号；dry-run 不发网络请求
- 本地要真实发送时，才需要企业微信 webhook

```bash
git clone https://github.com/teriyakiushi/dmao-wecom-notifier.git
cd dmao-wecom-notifier
npm ci
npm test
```

## 2. 命令

| 命令 | 作用 |
| --- | --- |
| `npm test` | `node --test`，单元/集成测试 |
| `npm run test:watch` | 监听模式 |
| `npm run dev -- --dry-run ...` | 直接用 `src/cli.mjs` 跑，不走 dist |
| `npm run build` | esbuild 打包到 `dist/index.mjs` |
| `npm run build:check` | 重建到临时文件，与已提交的 `dist/index.mjs` 比较 |
| `npm run smoke` | 用 dist + push fixture dry-run |
| `npm run lint:syntax` | 对 `src`/`scripts`/`test` 做 `node --check` |

示例：

```bash
npm run dev -- --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push

npm run dev -- --dry-run --preset card \
  --title 部署完成 --content "v1.2.3" \
  --link-url https://github.com/teriyakiushi/dmao-wecom-notifier
```

`npm run dev` 后面的 `--` 是给 CLI 的参数分隔符。

## 3. 目录结构

```text
.
├── action.yml                 # Composite Action 元数据
├── dist/index.mjs             # 提交的打包产物（由 src 生成）
├── src/
│   ├── cli.mjs                # 参数解析 + 入口
│   ├── index.mjs              # 编排：读事件/config → 渲染 → 校验 → 发送
│   ├── inputs.mjs             # Action 输入默认值/解析
│   ├── context.mjs            # 安全模板上下文
│   ├── config.mjs             # YAML/JSON、路径、按事件发现模板
│   ├── log.mjs                # 日志、掩码、step summary
│   ├── errors.mjs             # 错误类型
│   ├── util.mjs               # 纯工具函数
│   ├── template/
│   │   ├── expression.mjs     # {{ }} 表达式/过滤器
│   │   └── render.mjs         # $if / $each 等指令
│   ├── presets/
│   │   ├── index.mjs          # 内置预设注册表
│   │   └── helpers.mjs        # 卡片/列表/输入解析辅助
│   └── message/
│       ├── normalize.mjs      # 类型别名、数值、图片 MD5
│       ├── truncate.mjs       # 字节截断
│       ├── validate.mjs       # 企业微信约束校验
│       └── send.mjs           # webhook POST/重试/错误分类
├── scripts/build.mjs
├── test/                      # node:test
├── tests/fixtures/events/     # 事件 payload
├── docs/                      # 文档 + 静态 builder
│   └── index.html             # GitHub Pages 构建器
├── examples/
└── .github/workflows/         # CI / release / pages
```

## 4. 数据流

```text
GITHUB_EVENT_PATH 或 --event
        │
        ▼
   buildContext()  ← env + inputs.vars
        │
        ▼
   loadConfig()    ← payload / template / template-dir
        │
        ▼
   基础消息         ← payload / extends(preset)
        │
        ▼
   deepMerge(config.overrides, inputs.overrides)
        │
        ▼
   renderMessage() ← {{ }} / $if / $each
        │
        ▼
   pruneEmpty → normalizeMessage → truncateMessage → validateMessage
        │
        ├── dry-run：输出 JSON / GITHUB_OUTPUT / summary
        └── 发送：sendToWeCom() → 结果输出
```

关键约定：

- 渲染前不发送；校验失败绝不发送。
- `fail-on-error: false` 只把失败降级为 warning，不会发送非法消息。
- 所有日志中的 webhook/key 都走 `logger.redact`。
- 输出 `payload` 最多 64KB；完整 payload 以发送请求为准。

## 5. 构建与 dist

`dist/index.mjs` 是**提交进仓库**的产物，Action 直接运行它，用户不需要 `npm install`。

```bash
npm run build
npm run build:check
git add dist/index.mjs
```

- 打包入口是 `src/cli.mjs`，不是 `src/index.mjs`。
- esbuild：`platform: node`、`format: esm`、`target: node18`。
- `yaml` 会被打进 bundle；banner 注入 `createRequire`，避免 CJS 动态 require 在 ESM 下失败。
- 修改 `src` 后必须重新 build 并提交 dist；CI 的 `build:check` 会失败如果 dist 落后。
- 不要在 `dist` 里手改。

## 6. 测试

```bash
npm test
npm test -- --test-name-pattern="send"
```

现有测试覆盖：

- `test/expression.test.mjs`：路径、比较、逻辑、过滤器、转义。
- `test/render.test.mjs`：`$if`、`$each`、`$join`、`$as`、限制。
- `test/config.test.mjs`：YAML 解析、按事件发现、二义性、路径逃逸。
- `test/message.test.mjs`：归一、MD5、截断、校验（含可选 type 行）。
- `test/send.test.mjs`：URL/key、成功、重试、45009、93000 不重试。
- `test/index.test.mjs`：编排、dry-run、输出、fail-on-error。

新增行为时优先加测试，尤其是：

- 模板表达式边界（空值、未知路径、过滤器参数）；
- 企业微信可选字段（horizontal/jump/quote 的 type 缺省）；
- 重试分类（哪些 errcode 不重试）；
- 路径/安全边界（symlink、`..`、绝对路径）。

## 7. 扩展点

### 加一个内置预设

1. 在 `src/presets/index.mjs` 写 `xxxPreset(ctx, inputs)`，返回企业微信消息对象。
2. 加入 `BUILTIN_PRESETS`；如需自动触发，加入 `AUTO_EVENT_PRESETS`。
3. 用 `makeTextNotice` / `makeNewsNotice` / `fitTitle` / `hList` / `jumps` 等 helper，避免重复处理长度。
4. 加测试：`getPreset('xxx', {ctx, inputs})` 能通过 normalize/validate。
5. 更新 `docs/events.md` 和 README 的预设列表。

事件别名（例如 GitHub 的 Star 事件名是 `watch`）放在 `AUTO_EVENT_PRESETS`，不要改 GitHub 的事件名。

### 加一个过滤器

1. 在 `src/template/expression.mjs` 的 `FILTERS` 加纯函数；参数从 `args` 取。
2. 不要做 I/O、不要读 env、不要 eval。
3. 加 `test/expression.test.mjs`；更新 `docs/templates.md` 的过滤器表。

### 加消息字段/类型

1. `normalize.mjs`：接受别名、做数值/类型归一。
2. `validate.mjs`：按 91770 文档实现必填/选填/上限；可选字段不要过度收紧。
3. `truncate.mjs`：只裁硬字节限制，推荐长度用 warning。
4. 测试合法与非法样例；更新 `docs/wecom.md`。

### 改 builder

`docs/index.html` 是单文件静态页，不需要构建：

- 直接双击打开，或 `python -m http.server` 后访问；
- 修改后手动验证：切换类型、编辑、预览、复制/下载 JSON/YAML、Action 步骤导出、图片 MD5；
- 它不参与 Action 运行时，也不参与 `npm test`；但字段结构必须与 `src/message/*` 保持一致。

## 8. CI 与发布

目标 workflow：

- `ci.yml`：`npm ci` → `npm test` → `npm run build:check` → `npm run lint:syntax`；可选 `uses: ./` dry-run 冒烟。
- `release.yml`：手动/tag 触发，构建后创建 GitHub Release。
- `pages.yml`：从 `docs/` 发布 builder。

发布检查：

```bash
npm ci
npm test
npm run build
npm run build:check
npm run smoke
git status --short        # dist 必须已提交
```

- tag 用语义化版本（如 `v0.1.0`），移动 major tag（`v1`）前确认兼容性。
- `action.yml` 的 `runs.steps` 引用 `dist/index.mjs`；发布 tag 必须包含 dist。
- GitHub Marketplace 发布需要 `action.yml` 的 name/description/branding；非必需。
- 仓库 owner：`teriyakiushi`；默认分支 `main`；MIT。

## 9. 约定

- ESM（`.mjs`），不使用 TypeScript；Node 18+ API。
- 不新增运行时依赖，除非有明确理由；`yaml` 是唯一运行时依赖，`esbuild` 只用于构建。
- 错误用 `ConfigError` / `TemplateError` / `ValidationError` / `WeComError`，带 `code`/`path`/`hint`。
- 不把 secret 写进异常消息、日志、summary；新增日志先想 redact。
- 纯函数优先放 `util.mjs`；不要为了方便在渲染器里读文件/环境变量。
- 模板表达式保持“小而可审计”，不要引入通用表达式引擎。
- 文档改动与代码同一 PR；中文为主，英文 README 同步关键行为。

## 10. 常见开发问题

| 问题 | 处理 |
| --- | --- |
| `Dynamic require of "process" is not supported` | dist 的 banner 丢了；检查 `scripts/build.mjs` 的 `createRequire` 注入 |
| dry-run 跑了两次 / 报 `E_WEBHOOK_MISSING` | 入口重复执行；确认 bundle 入口是 `src/cli.mjs`，`src/index.mjs` 没有自执行块 |
| `build:check` 失败 | 改了 src 没重新 build；`npm run build` 后提交 dist |
| Action 找不到 dist | tag 里没提交 dist，或 `uses:` 指向错误路径 |
| 测试里 `$as` 报错 | `$as` 是字面标识符，不要写 `{{ }}` |
| 自定义行被要求 `url` | 不要给纯文本行加 `type: 1`；horizontal 的 type 可省略 |
