# 示例（图文卡片）

三个供参考的模板，全部走 `template_card` / `news_notice`

| 文件 | 事件 | 内容 |
| --- | --- | --- |
| `wecom-push.yml` | `push` | Push Notice |
| `wecom-ci-failure.yml` | `workflow_run` | CI Failure Notice |
| `wecom-workflow_run.yml` | `workflow_run` | CI Notice |

`wecom-ci-failure.yml` 精确、单薄；`wecom-workflow_run.yml` 覆盖所有结论。**同一个仓库只留一个 CI 模板**：

- 只想在CI寄的时候播报：用 `wecom-ci-failure.yml`（文件名不以 `-workflow_run.yml` 结尾，`template-dir` 的自动匹配不会命中，必须显式传 `template:`）；
- 想知道每次结果：用 `wecom-workflow_run.yml`，改名为 `workflow_run.yml` 或保持 `*-workflow_run.yml` 让 `template-dir` 自动命中。

## 关于 markdown_v2

企业微信的 `markdown_v2` **不支持图片**（`![]()` 只会被当成普通文本）。想要图文只有两条路：

1. `news`：文章列表，`articles[].picurl` 是缩略图；
2. `template_card` + `card_type: news_notice`：大图 + 标题 + 引用块 + 跳转按钮。

本目录的模板都用第 2 种，`card_image` 与 `image_text_area.image_url` 指向同一个公网直链。

## 图片

来源 safebooru。企业微信对 `card_image.aspect_ratio` 的要求是 **1.3 < ratio < 2.25**（左闭右开校验见 `src/message/validate.mjs:467`），越界直接 `E_CARD_IMAGE_RATIO` 拦下不发。

有两张是 1:1 方图，只能取区间下限 **1.33**，卡片里上下会裁掉一点；换图时把 `aspect_ratio` 改成图片真实宽高比，不能直接硬写 1.78，否则会拉伸。

## 用法

```text
your-repo/
├── .github/workflows/ci-notify.yml
└── .github/wecom-notify/
    └── wecom-ci-failure.yml
```

```yaml
name: CI notify
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  notify:
    if: github.event.workflow_run.conclusion != 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: teriyakiushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
          template: .github/wecom-notify/wecom-ci-failure.yml
```

全结论版把 `if:` 去掉，`template:` 换成 `wecom-workflow_run.yml`（或直接用 `template-dir: .github/wecom-notify` 自动匹配）。

## 本地验证

最省事的是 `scripts/preview-custom.mjs`（`npm run preview`）：按文件名猜事件、自动配 fixture、批量渲染、写 HTML，加 `--send` 就真发。

```bash
npm run preview -- --list                              # 有哪些模板、各自什么事件
npm run preview                                        # 全部 dry-run → .research/tmp/<模板名>.html
npm run preview -- ci                                  # 只跑 wecom-ci-failure.yml（片段匹配）
npm run preview -- ci --send                           # 真发，webhook 取 .env 的 WECOM_WEBHOOK
npm run preview -- workflow_run --conclusion success   # 换结论，看“绿了”那张卡
npm run preview:i                                      # 交互式菜单：选模板 → 选结论 → 选 dry-run/真发
```

等价的手写命令（不想用脚本时）：

```bash
node src/cli.mjs --dry-run \
  --event tests/fixtures/events/workflow_run.json \
  --event-name workflow_run \
  --template examples/custom/wecom-ci-failure.yml \
  --html .research/tmp/ci-failure.html

# 真发：webhook 走环境变量，别写进 argv
INPUT_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' \
node src/cli.mjs --event tests/fixtures/events/workflow_run.json \
  --event-name workflow_run --template examples/custom/wecom-ci-failure.yml
```

## 模板里的几个小技巧

- `quote_area` 上挂 `$if: workflow_run.head_commit`：没有提交信息时整块消失，避免空的 `quote_text` 被校验拦下。
- `vertical_content_list` 的每个元素各挂一个 `$if`：条件不成立的元素被剪掉，所以一张卡只会出现当前结论对应的那句话。
- `horizontal_content_list` 的 `keyname` 建议 ≤ 5 字、`value` ≤ 26 字；`jump_list` 最多 3 项、`title` ≤ 13 字，超了会给 `W_FIELD_LENGTH`。

字段长度上限（`src/message/validate.mjs`）：`main_title.title` 26 字、`main_title.desc` 30 字、`image_text_area.title` 26 字 / `desc` 112 字、`source.desc` 13 字、`quote_area.quote_text` 500 字。
