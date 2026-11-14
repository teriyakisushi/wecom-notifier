# 示例

这些文件是**示例**，不会被自动执行。复制到你的仓库后再改 `webhook` 和事件。

```text
examples/
├── workflows/
│   ├── push-notify.yml          # 最小 push 通知
│   ├── pr-card.yml              # PR 卡片 + 仓库内模板
│   ├── workflow-run-failure.yml # CI 失败告警
│   └── inline-payload.yml       # 内联 payload，不用模板文件
├── wecom-notify/
│   ├── wecom-push.yml            # 复制到 .github/wecom-notify/
│   ├── pr-card.yml              # 复制到 .github/wecom-notify/pull_request.yml
│   ├── wecom-workflow_run-variants.yml  # variants/when/for 可读写法示例
│   └── default.yml              # 复制到 .github/wecom-notify/default.yml
└── custom/
    ├── wecom-push.yml            # push 图文卡片（整活版）
    ├── wecom-ci-failure.yml      # 只发失败：CI 挂了才发
    ├── wecom-workflow_run.yml    # 绿了 / 寄了 / 凉了 / 还在跑
    └── README.md                 # 图片选型与字段长度限制
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
      - uses: teriyakisushi/wecom-notifier@v1
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
  - uses: teriyakisushi/wecom-notifier@v1
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
      - uses: teriyakisushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
          preset: workflow_run
```

注意 `workflow_run` 的 workflow 必须存在于默认分支；`workflows` 名字要和被监听的 workflow `name:` 完全一致。

## 4. 内联 payload

`inline-payload.yml` 不依赖仓库模板，适合单仓库临时通知：

```yaml
- uses: teriyakisushi/wecom-notifier@v1
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

`wecom-notify/wecom-push.yml` 演示：

- `extends: push` 继承内置预设；
- `overrides` 改来源、标题、键值行；
- `$each` 用 `commits` 生成最多 3 行；
- `vars` 从 Action 输入传入。

复制到 `.github/wecom-notify/wecom-push.yml` 后，push 事件会自动找到它。注意同一事件只保留一个文件。

## 6. 按状态切换：`variants` + `when` + `for`

`wecom-notify/wecom-workflow_run-variants.yml` 用可读写法重写了一张 CI 卡：

```yaml
template_card:
  variants:
    by: workflow_run.conclusion
    cases:
      success:
        source: { desc: "通过", desc_color: 3 }
        main_title: { title: "{{ repo.name }} 构建通过" }
      failure:
        source: { desc: "失败", desc_color: 2 }
        main_title: { title: "{{ repo.name }} 构建失败" }
    default:
      source: { desc: "运行中", desc_color: 0 }
  main_title:
    desc: "#{{ workflow_run.run_number }} · {{ workflow_run.head_branch }}"
  horizontal_content_list:
    - when: workflow_run.event == "push"
      keyname: 触发
      value: push
```

三个要点：

- `variants` 命中的分支**深度合并**到本对象：`main_title.title` 按状态变，`desc` 仍然共用。
- `when` 写在数组元素上，条件不成立时整行消失，不用给每个字段重复写条件。
- `for` 遍历数组；源为空时渲染成空数组，随后被剪掉，不会留下空块。

`items` 里的 `$` 写法（`$if` / `$each`）继续支持，老模板不用改。

## 7. 本地验证

```bash
npm run dev -- --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push \
  --template .github/wecom-notify/wecom-push.yml
```

或者用构建器 `docs/index.html` 编辑消息体，导出 YAML 后替换模板文件。构建器不会替换 `{{ }}`，导出后仍可继续用模板变量。
