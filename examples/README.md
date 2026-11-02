# 示例

这些文件是**示例**，不会被自动执行。复制到你的仓库后再改 `webhook` 和事件。

```text
examples/
├── workflows/
│   ├── push-notify.yml          # 最小 push 通知
│   ├── pr-card.yml              # PR 卡片 + 仓库内模板
│   ├── workflow-run-failure.yml # CI 失败告警
│   └── inline-payload.yml       # 内联 payload，不用模板文件
└── wecom-notify/
    ├── dmao-push.yml            # 复制到 .github/wecom-notify/
    ├── pr-card.yml              # 复制到 .github/wecom-notify/pull_request.yml
    └── default.yml              # 复制到 .github/wecom-notify/default.yml
```

## 1. 最小 push 通知

复制 `workflows/push-notify.yml`：

```yaml
name: WeCom push notification

on:
  push:
    branches: [main]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: teriyakiushi/dmao-wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
```

不需要 checkout；没有模板文件时使用内置 `push` 预设。

## 2. PR 卡片 + 一事件一文件

复制 `workflows/pr-card.yml` 和 `wecom-notify/pr-card.yml`：

```text
your-repo/
├── .github/workflows/pr-card.yml
└── .github/wecom-notify/pull_request.yml
```

workflow 必须 checkout，否则 runner 上看不到模板：

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: teriyakiushi/dmao-wecom-notifier@v1
    with:
      webhook: ${{ secrets.WECOM_WEBHOOK }}
      template-dir: .github/wecom-notify
```

事件文件按 `GITHUB_EVENT_NAME` 自动匹配；`pull_request.yml` 只处理 PR，不会影响 push。

## 3. CI 失败告警

`workflow-run-failure.yml` 监听名为 `CI` 的 workflow 完成，只在失败时发送：

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  notify:
    if: github.event.workflow_run.conclusion != 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: teriyakiushi/dmao-wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
          preset: workflow_run
```

注意 `workflow_run` 的 workflow 必须存在于默认分支；`workflows` 名字要和被监听的 workflow `name:` 完全一致。

## 4. 内联 payload

`inline-payload.yml` 不依赖仓库模板，适合单仓库临时通知：

```yaml
- uses: teriyakiushi/dmao-wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    payload: |
      msgtype: markdown
      markdown:
        content: |
          ### 🚀 部署完成
          > 仓库：${{ github.repository }}
          > 提交：${{ github.sha }}
```

`payload` 里的 `${{ }}` 由 GitHub 先展开；Action 自己的模板变量用 `{{ }}`。两层不要混淆。

## 5. 自定义卡片模板

`wecom-notify/dmao-push.yml` 演示：

- `extends: push` 继承内置预设；
- `overrides` 改来源、标题、键值行；
- `$each` 用 `commits` 生成最多 3 行；
- `vars` 从 Action 输入传入。

复制到 `.github/wecom-notify/dmao-push.yml` 后，push 事件会自动找到它。注意同一事件只保留一个文件。

## 6. 本地验证

```bash
npm run dev -- --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push \
  --template .github/wecom-notify/dmao-push.yml
```

或者用构建器 `docs/index.html` 编辑消息体，导出 YAML 后替换模板文件。构建器不会替换 `{{ }}`，导出后仍可继续用模板变量。
