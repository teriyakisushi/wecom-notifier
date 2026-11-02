# 内置预设

预设是开箱即用的消息种子。模板文件可以 `extends` 某个预设，再用 `overrides` 改字段；也可以完全不用预设，直接写消息。

## 1. 自动映射

`preset: auto` / `extends: auto` 按 `GITHUB_EVENT_NAME` 选择：

| GitHub 事件名 | 预设 | 说明 |
| --- | --- | --- |
| `push` | `push` | 推送/删除分支 |
| `pull_request` | `pull_request` | PR 打开、关闭、合并、同步、编辑等 |
| `pull_request_target` | `pull_request` | 复用 PR 预设 |
| `issues` | `issues` | Issue 打开、关闭、标签、指派等 |
| `issue_comment` | `issue_comment` | PR/Issue 评论 |
| `release` | `release` | Release 发布/编辑/删除 |
| `workflow_run` | `workflow_run` | 工作流运行完成/请求 |
| `watch` | `star` | GitHub 的 Star 事件名是 `watch`；也接受显式 `preset: star` |
| `fork` | `fork` | 仓库被 Fork |
| `create` / `delete` | `create` / `delete` | 创建/删除分支或标签 |
| 其他 | `generic` | 通用 Markdown 摘要 |

显式预设名：`auto`、`push`、`pull_request`、`issues`、`issue_comment`、`release`、`workflow_run`、`star`、`fork`、`create`、`delete`、`generic`、`text`、`markdown`、`card`、`none`。

> `pull_request_target` 与 `watch` 是事件别名；`extends`/`preset` 里写 `pull_request`、`star` 也可以。

## 2. 事件预设

所有事件预设输出 `template_card` / `text_notice`，除非特别说明。预设会按企业微信推荐长度截断自己的标题、键名、值（字符数），并自动去掉空字段；自定义模板不会静默裁剪。

### push

| 字段 | 内容 |
| --- | --- |
| `source` | `GitHub`，灰色 |
| 主标题 | `📦 owner/repo`；删除分支时 `🗑️ owner/repo` |
| 描述 | `actor 推送到 branch`；删除时 `actor 删除了 branch` |
| 强调 | 提交数（仅新增提交） |
| 正文 | 前 3 个提交的 first line，每行 `• ...`；超过 3 个加 `… 另有 N 个提交`；无提交为“没有新的提交” |
| 键值行 | 仓库 / 分支 / 提交数 |
| 跳转 | 对比链接、仓库 |
| 点击 | `compare_url`，回退 `commit_url`、事件详情、仓库 |

### pull_request

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub PR`；合并绿色、关闭红色、其他灰色 |
| 主标题 | `🎉/❌/📝/🔀 #number title` |
| 描述 | `author · 状态 · 动作`；状态：已合并/已关闭/草稿/待审阅 |
| 强调 | `+additions` / `-deletions`（payload 有数值时） |
| 引用 | PR body |
| 键值行 | 状态 / `base ← head` / 变更文件数 |
| 跳转 | 查看 PR |
| 动作映射 | `opened` 新开、`reopened` 重新打开、`closed` 关闭、`synchronize` 更新代码、`edited` 编辑、`ready_for_review` 可评审、`converted_to_draft` 转为草稿、`review_requested` 请求评审、`labeled` 加标签、`unlabeled` 移除标签、`assigned` 指派、`unassigned` 取消指派；其他为“更新” |

### issues

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub Issue`；关闭红色，其他灰色 |
| 主标题 | `✅/🐛 #number title` |
| 描述 | `author · 状态 · 动作` |
| 引用 | Issue body |
| 键值行 | 状态 / 标签 / 指派 |
| 跳转 | 查看 Issue |
| 动作映射 | `opened` 新开、`reopened` 重新打开、`closed` 关闭、`edited` 编辑、`deleted` 删除、`transferred` 转移、`pinned` 置顶、`unpinned` 取消置顶、`assigned` 指派、`unassigned` 取消指派、`labeled` 加标签、`unlabeled` 移除标签、`milestoned` 设里程碑、`demilestoned` 移除里程碑；其他为“更新” |

### issue_comment

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub 评论` |
| 主标题 | `💬 #number issue_title` |
| 描述 | `author 在 PR/Issue 中{新评论/编辑评论/删除评论}` |
| 引用 | 评论 body |
| 键值行 | 类型 / 仓库 / 评论 id |
| 跳转 | 评论链接，回退 Issue 链接 |

### release

| 字段 | 内容 |
| --- | --- |
| 来源 | `Release`；预发布黑色，正式发布绿色 |
| 主标题 | `🚀 tag` |
| 描述 | `name · author · 动作` |
| 引用 | Release body |
| 键值行 | 标签 / 是否预发布 / 资产数 |
| 跳转 | Release 页面 |
| 动作映射 | `published` 已发布、`unpublished` 取消发布、`created` 已创建、`edited` 已编辑、`deleted` 已删除、`prereleased` 预发布、`released` 正式发布 |

### workflow_run

| 字段 | 内容 |
| --- | --- |
| 来源 | `Actions`；成功绿色、失败/取消/超时红色、其他黑色 |
| 主标题 | `✅/❌/⏹️/… workflow name` |
| 描述 | `branch · event` |
| 强调 | 结果标签（成功/失败/已取消/…） |
| 键值行 | 分支 / 事件 / 状态 |
| 跳转 | 运行页面 |

### star（GitHub 事件名 watch）

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub Star`；新增绿色、取消红色 |
| 主标题 | `⭐ 收到新 Star` / `💔 Star 被取消` |
| 描述 | `actor Star 了仓库` / `actor 取消了 Star` |
| 强调 | star 数 |
| 正文 | 仓库描述 |
| 键值行 | 仓库 / Stars |
| 点击 | 仓库 |

> Webhook payload 通常不带实时的 `stargazers_count`；数字可能为 0 或旧值。需要精确数字时用 `event.*` 或自定义模板/API，不要依赖这个预设计数。

### fork

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub Fork` |
| 主标题 | `🍴 仓库被 Fork` |
| 描述 | `actor Fork 了仓库` |
| 引用 | 新仓库描述 |
| 键值行 | 原仓库 / 新仓库 |
| 跳转 | 新仓库 |
| 点击 | 新仓库，回退原仓库 |

### create / delete

| 字段 | 内容 |
| --- | --- |
| 来源 | `GitHub`；create 绿色、delete 红色 |
| 主标题 | `🌿 新建分支/标签` / `🗑️ 删除分支/标签` |
| 描述 | `actor 创建/删除了 ref` |
| 键值行 | 仓库 / 类型 / 引用 |
| 跳转 | create：分支/标签页面；delete：仓库 |

### generic

输出 Markdown：

```markdown
### 📣 owner/repo

> 事件：`event_name` · `event_action`
> 触发者：actor
> 引用：`ref_name`

[查看详情](https://github.com/owner/repo/actions/runs/1234567890)
```

没有 `ref_name` 时省略引用行；详情 URL 依次取 `run_url`、`detail_url`、`repo.html_url`。适合没有专门预设的事件。

## 3. 通用预设

### text / markdown

```yaml
preset: text
content: "部署完成：v1.2.3"
```

```yaml
preset: markdown
content: |
  ### 部署完成
  - 版本：v1.2.3
  - 环境：production
  [查看运行](https://github.com/...)
```

- 必须提供 `content`；为空报 `E_PRESET_CONTENT`。
- `text` 受 2048 字节限制，`markdown` 受 4096 字节限制；`auto-truncate: true` 时会截断。
- 这两个预设不读取 `title`/`subtitle`/`info`/`links`。

### card

扁平输入生成卡片；见 [配置 §6](configuration.md#6-扁平输入与-preset-card)。

- 没有 `image-url` → `text_notice`；
- 有 `image-url` → `news_notice`，同时生成 `card_image` 和 `image_text_area`；
- `link-url` 为空时自动回退：第一条 `links`、`detail_url`、`repo.html_url`；
- `title` 为空时回退 `repo.full_name`；
- `card_action` 始终有值，不会使用 `example.com` 占位；
- `info` 最多 6 行，`links` 最多 3 条；超出直接报错，不静默丢弃。

### none

返回空消息。用于“完全不使用自动预设”的场景：

```yaml
extends: none
overrides:
  msgtype: markdown
  markdown:
    content: "自定义内容"
```

单独 `preset: none` 而没有 `payload`/`overrides` 会因为没有消息而报错；它本身不是“不发送”开关。需要“不发送”请用 workflow 的 `if:` 或 `dry-run`。

## 4. 自定义事件预设

仓库里按事件放文件即可覆盖自动预设：

```yaml
# .github/wecom-notify/dmao-push.yml
extends: push
overrides:
  template_card:
    source:
      desc: 我的项目
    main_title:
      title: "📦 {{ repo.name }} · {{ ref_name }}"
```

或者只改几个字段：

```yaml
# .github/wecom-notify/pull_request.yml
overrides:
  template_card:
    source:
      desc_color: 3
```

只写 `overrides` 时默认 `extends: auto`，即当前事件预设。文件发现规则见 [配置 §4](configuration.md#4-一事件一文件)。

## 5. 预设与模板的边界

- 事件预设不使用 `title`/`subtitle`/`content`/`info`/`links` 等扁平输入；要改文案请用模板文件 `overrides`。
- `preset: card` 才使用扁平卡片输入。
- `preset: text` / `markdown` 只使用 `content`。
- 预设的标题/键名/值会按企业微信推荐长度截断；`sub_title_text` 最多 112 字符（预设按字符截断，不是字节）。
- 所有消息在发送前仍会经过归一、字节截断和校验；预设不是“一定合法”的保证。
