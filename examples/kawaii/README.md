# 猫娘风格通知示例（图文卡片）

两套可直接抄的模板，走 `template_card` / `news_notice`（企业微信里唯一能“图 + 文 + 跳转”的卡片形态）：

| 文件 | 事件 | 内容 |
| --- | --- | --- |
| `wecom-push.yml` | `push` | 新爪印（提交）播报，带对比链接 |
| `wecom-workflow_run.yml` | `workflow_run` | CI 结果播报，成功 / 失败 / 取消 / 还在跑 各一句台词 |

## 关于 markdown_v2

企业微信的 `markdown_v2` **不支持图片**（`![]()` 只会被当成普通文本）。想要图文只有两条路：

1. `news`：文章列表，`articles[].picurl` 是缩略图；
2. `template_card` + `card_type: news_notice`：大图 + 标题 + 引用块 + 跳转按钮。

本目录两个模板都用第 2 种，`card_image` 与 `image_text_area.image_url` 指向同一个公网直链。

## 图片

| 用途 | 直链 | 尺寸 | ratio | 体积 |
| --- | --- | --- | --- | --- |
| push | `https://safebooru.org/images/854/fa20e9837540717cda2743d5cad4ff81.png` | 1280×720 | 1.78 | 494 KB |
| CI | `https://safebooru.org/images/592/b50779324dec27143ae2c51ecd7fbfca.jpeg` | 1600×900 | 1.78 | 335 KB |

来源 safebooru（`rating:safe` 标签过滤）。企业微信对 `card_image.aspect_ratio` 的要求是 **1.3 < ratio < 2.25**（左闭右开校验见 `src/message/validate.mjs:467`），所以选图时先按 `width / height` 过滤，16:9 的 1.78 最稳。

换图时只要保持 `url` + `aspect_ratio` 同步即可，`aspect_ratio` 用图片真实宽高比，写错会渲染变形。

## 用法

```text
your-repo/
├── .github/workflows/kawaii.yml
└── .github/wecom-notify/
    ├── wecom-push.yml
    └── wecom-workflow_run.yml
```

```yaml
name: Kawaii notify
on:
  push:
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: teriyakiushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
          template-dir: .github/wecom-notify
```

同一事件只会命中一个文件：`wecom-push.yml` 靠 `*-push` 匹配，`wecom-workflow_run.yml` 靠 `*-workflow_run` 匹配。

## 本地验证

```bash
# 渲染 + 校验，不发送
node src/cli.mjs --dry-run \
  --event tests/fixtures/events/push.json \
  --event-name push \
  --template-dir examples/kawaii

# 真发（webhook 建议走环境变量 INPUT_WEBHOOK，别写进 argv）
INPUT_WEBHOOK='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' \
node src/cli.mjs --event tests/fixtures/events/push.json \
  --event-name push --template-dir examples/kawaii
```

## 模板里的两个小技巧

- `quote_area` 上挂 `$if: commit_count > 0`：空推 / 建分支时整块消失，避免空的 `quote_text` 被校验拦下。
- `vertical_content_list` 的每个元素各挂一个 `$if`：条件不成立的元素被剪掉，所以一张卡只会出现当前结论对应的那句台词。

字段长度上限（`src/message/validate.mjs`）：`main_title.title` 26 字、`main_title.desc` 30 字、`image_text_area.title` 26 字 / `desc` 112 字、`source.desc` 13 字、`quote_area.quote_text` 500 字。超了不会报错，但会给 `W_FIELD_LENGTH` 警告。
