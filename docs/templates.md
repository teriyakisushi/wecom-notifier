# 模板

模板就是 YAML/JSON 里的字符串字段，用 `{{ }}` 插入上下文、`$if` 控制是否保留字段、`$each` 生成列表。Action 不把模板当代码执行；表达式解析器只支持本文列出的语法。

## 1. 插值

```yaml
main_title:
  title: "📦 {{ repo.name }}"
sub_title_text: "{{ actor }} 推送了 {{ commit_count }} 个提交"
```

- `{{ repo.name }}` 读取上下文。
- 整段字符串恰好是一个表达式时，保留原始类型：

  ```yaml
  desc_color: "{{ vars.color }}"   # vars.color 是数字时输出数字 3，不是 "3"
  ```

- 表达式嵌在其他文字中时，按字符串拼接；数组/对象会被 JSON 序列化。
- 找不到的路径得到空字符串（整段表达式时为 `undefined`，随后被剪空）。
- YAML 中想输出字面量 `{{`，写成 `\{{`，并使用单引号或块标量：

  ```yaml
  content: '示例：\{{ 这不是模板 }}'
  ```

  不要写成双引号 `"\{{"`，YAML 会把它当成非法转义。

## 2. 路径与字面量

支持：

```text
repo.full_name
repo.owner
commits[0].short_sha
event.pull_request.number
vars.environment
```

- 标识符：字母/下划线/`$` 开头，后接字母、数字、下划线、`$`。
- 数组下标用 `[0]`。
- 字面量：`"text"`、`'text'`、`42`、`3.14`、`true`、`false`、`null`。
- 不支持函数调用、算术、赋值、对象字面量、三元表达式。
- 禁止访问 `__proto__` / `constructor` / `prototype`。

比较与逻辑：

```text
{{ event.pull_request.number > 100 }}
{{ event.action == "opened" }}
{{ event.pull_request && event.pull_request.merged }}
{{ !event.pull_request }}
{{ (event.action == "opened" || event.action == "reopened") && repo.private }}
```

返回布尔值；整段表达式保留 boolean。字符串比较区分大小写。

## 3. 过滤器

过滤器用 `|` 串联，参数可用括号或冒号：

```text
{{ head_commit.message | firstLine | truncate(60) }}
{{ repo.name | upper }}
{{ vars.url | default("https://github.com") }}
```

| 过滤器 | 说明 |
| --- | --- |
| `default(value)` | 当前值为 `undefined` / `null` / `''` 时返回参数，否则原样返回。 |
| `truncate(n)` | 按 Unicode 字符截断到 `n` 个（默认 80），超出加 `…`。 |
| `truncateBytes(n)` | 按 UTF-8 字节截断到 `n` 字节（默认 300），超出加 `…`，不会切断多字节字符。 |
| `firstLine` | 取第一行并 `trim()`。 |
| `oneLine` | 所有空白折叠为一个空格并 `trim()`。 |
| `upper` / `lower` | 大小写转换。 |
| `replace(from, to)` | 普通文本替换（不是正则）；`from` 为空时原样返回。 |
| `join(sep)` | 数组用 `sep`（默认 `", "`）连接；非数组原样字符串化。 |
| `take(n)` | 数组取前 `n` 项；字符串取前 `n` 个字符。 |
| `skip(n)` | 数组跳过前 `n` 项；字符串跳过前 `n` 个字符。 |
| `first` / `last` | 数组首/尾元素；字符串首/尾字符。 |
| `length` | 数组长度、字符串字符数、对象键数。 |
| `json` | `JSON.stringify`；失败时退回字符串化。 |
| `urlencode` | `encodeURIComponent`。 |
| `escapeMd` | 给 Markdown 特殊字符加反斜杠转义。 |

过滤器参数可以是字面量，也可以是路径表达式：

```text
{{ event.repository.description | default("暂无描述") | truncate(50) }}
{{ vars.tags | take(3) | join(" / ") }}
```

## 4. 指令

指令是对象里的特殊键，只在**当前对象**生效。

每个指令都有两种写法：可读别名与 `$` 前缀原名。两种完全等价，**同一个对象里不要混用同一条指令**：

| 别名 | 原名 | 作用 |
| --- | --- | --- |
| `when` | `$if` | 条件成立时保留对象 |
| `for` | `$each` | 遍历数组 |
| `item` | `$item` | 每个元素的模板 |
| `as` | `$as` | 循环变量名（默认 `item`） |
| `limit` | `$limit` | 最多渲染几项 |
| `join` | `$join` | 用分隔符拼成字符串 |
| `prefix` / `suffix` | `$prefix` / `$suffix` | 拼字符串时的前后缀 |

```yaml
# 两种写法混着用也没问题，只要同一条指令只出现一次
horizontal_content_list:
  for: commits
  limit: 3
  as: commit
  item:
    keyname: "{{ commit.short_sha }}"
    value: "{{ commit.first_line | truncate(24) }}"
```

新写模板建议用别名；`$` 写法继续支持，老模板不用改。

### $if / when

条件为真时保留整个对象；为假时返回 `undefined`，随后被剪空（父对象里该键消失，数组里该元素被去掉）。

```yaml
main_title:
  $if: event.pull_request
  title: "PR #{{ event.pull_request.number }}：{{ event.pull_request.title }}"
```

条件写法：

```yaml
$if: event.action == "opened"
$if: "{{ event.action == 'opened' }}"
$if: true
```

也接受数字（0 为假）；空字符串/空值视为假。

同一个对象里 `when` 和 `$if` 只能出现一个，否则报错。

### $each / $item（别名 `for` / `item`）

`for`（或 `$each`）指向数组，`item`（或 `$item`）是每个元素的模板；结果是一个数组。

```yaml
horizontal_content_list:
  $each: commits
  $limit: 3
  $as: commit
  $item:
    keyname: "{{ commit.short_sha }}"
    value: "{{ commit.first_line | truncate(24) }}"
```

- 不写 `$as` 时用 `item`。
- `$as` 必须是合法标识符；写字符串，不要写表达式。
- `$item` 可以是对象、数组或标量。
- 源不是数组 → 渲染错误；`undefined` / `null` 视为空数组。
- `$limit` 必须是正整数；最多 100（超出按 100 处理并给 `W_EACH_LIMIT` warning）。
- 遍历指令和条件指令不能放在同一个对象上（`when` 与 `for` 也不能）；需要过滤时把条件写进 `item` 的子对象，或包一层父对象。
- 遍历对象里只允许上表列出的键，多余字段会直接报错并提示可用键名。

### $join / $prefix / $suffix

`$each` + `$join` 把结果变成字符串；`$prefix` / `$suffix` 只能和 `$join` 一起用：

```yaml
sub_title_text:
  $each: commits
  $limit: 3
  $join: "\n"
  $prefix: "最近提交：\n"
  $suffix: "\n…"
  $item: "- {{ item.short_sha }} {{ item.first_line | truncate(40) }}"
```

输出：

```text
最近提交：
- abc1234 fix: ...
- def5678 docs: ...
…
```

注意 YAML 引号：需要真实换行时用双引号 `"\n"` 或块标量 `|`；单引号里的 `\n` 是两个字面字符。

### variants：按状态切换整块内容

同一个卡片常常要按结论（成功 / 失败 / 取消）换标题、换颜色、换文案。用 `variants` 把分支写在一起，比给十几个字段各挂一个 `when` 好读得多：

```yaml
template_card:
  card_type: text_notice
  main_title:
    title: "{{ repo.name }}"
    desc: "{{ workflow.name }}"
  variants:
    by: workflow_run.conclusion
    cases:
      success:
        source: { desc: "通过", desc_color: 3 }
        main_title:
          title: "{{ repo.name }} 构建通过"
      failure:
        source: { desc: "失败", desc_color: 2 }
        main_title:
          title: "{{ repo.name }} 构建失败"
    default:
      source: { desc: "进行中", desc_color: 0 }
```

规则：

- `by` 是任意表达式或路径，取到的值用来选分支；也接受 `key` 作为同义键。
- `cases` 是 `值 → 对象` 的映射，命中的对象会**深度合并**到本对象上：同名字段被覆盖，分支里写 `null` 可以删掉某个兄弟键。
- `default` 可选；既不命中又没有 `default` 时保留本对象其余字段，并给一条 `W_VARIANT_UNMATCHED` warning。
- 分支键按字符串比较，`1` 与 `"1"` 等价；布尔值写成 `"true"` / `"false"`。
- `variants` 只能出现在对象里，数组元素也可以按分支切换。
- 只允许 `by` / `key` / `cases` / `default` 四个键，写错会直接报错。

### 一个完整示例

```yaml
msgtype: template_card
template_card:
  card_type: news_notice
  source:
    desc: "{{ vars.environment }}"
    desc_color: 2
  main_title:
    title: "{{ repo.name }} 有新版本"
    desc: "{{ short_sha }} · {{ actor }}"
  card_image:
    url: "{{ vars.image }}"
    aspect_ratio: 1.7
  image_text_area:
    type: 1
    url: "{{ compare_url }}"
    title: "变更 {{ commit_count }} 个提交"
    desc: "{{ head_commit.message | firstLine | truncate(60) }}"
  horizontal_content_list:
    $each: commits
    $limit: 3
    $as: commit
    $item:
      keyname: "{{ commit.short_sha }}"
      value: "{{ commit.first_line | truncate(24) }}"
  card_action:
    type: 1
    url: "{{ detail_url }}"
```

## 5. 上下文

### 通用

| 路径 | 说明 |
| --- | --- |
| `event` | 当前事件原始 payload。 |
| `event_name` | 事件名，如 `push`、`pull_request`。 |
| `event_action` | `event.action`；没有则为空。 |
| `actor` | 触发者登录名（优先 `GITHUB_ACTOR`，其次 payload）。 |
| `triggering_actor` | 实际触发者（`GITHUB_TRIGGERING_ACTOR`，回退 `actor`）。 |
| `sender` | payload 的 `sender` 对象。 |
| `repository` | 原始 `event.repository` 对象。 |
| `repo` | 标准化仓库对象，见下。 |
| `github` | 安全的 GitHub 环境子集，见下。 |
| `ref` / `ref_name` / `ref_type` | 完整 ref、短名、`branch`/`tag`。 |
| `branch` / `tag` | 当前分支/标签（按 ref 类型）。 |
| `sha` / `short_sha` | 完整/7 位提交 SHA。 |
| `workflow` / `job` | workflow 名 / job id。 |
| `run_id` / `run_number` / `run_attempt` / `run_url` | 运行信息。 |
| `commits` | 提交数组，最多来自 payload；每项增强 `short_sha`、`first_line`、`one_line`、`author_name`、`author_login`。 |
| `commit_count` | `commits.length`。 |
| `head_commit` | 最后一个提交（增强后）。 |
| `compare_url` / `commit_url` / `detail_url` | 比较/提交/事件详情 URL，按事件推导。 |
| `now` / `now_unix` | ISO UTC 时间 / Unix 秒。 |
| `vars` | 合并后的自定义变量。 |

`repo` 常用字段：`owner`、`owner_login`、`name`、`full_name`、`html_url`、`url`、`default_branch`、`description`、`private`、`fork`、`stargazers_count`、`forks_count`、`open_issues_count`。

`github` 只包含安全子集：`repository`、`repository_owner`、`actor`、`triggering_actor`、`event_name`、`ref`、`ref_name`、`ref_type`、`sha`、`run_id`、`run_number`、`run_attempt`、`workflow`、`job`、`server_url`、`api_url`、`workspace`、`event_path`、`action_path`。**不包含** token、secrets、完整 env、Action inputs 或任意环境变量。

### 按事件

| 路径 | 何时有值 | 常用字段 |
| --- | --- | --- |
| `pr` / `pull_request` | pull_request 事件 | `number`、`title`、`html_url`、`user.login`、`head.ref`、`head.sha`、`base.ref`、`merged`、`additions`、`deletions`、`changed_files`、`labels` |
| `issue` | issues / issue_comment | `number`、`title`、`html_url`、`user.login`、`labels`、`state` |
| `comment` | issue_comment | `body`、`html_url`、`user.login` |
| `release` | release | `tag_name`、`name`、`html_url`、`body`、`author.login`、`prerelease` |
| `workflow_run` | workflow_run | `name`、`conclusion`、`status`、`html_url`、`head_branch`、`head_sha`、`event` |
| `star` | star | `action`、`count`（仓库当前 star 数） |
| `fork` | fork | `forkee`（分叉仓库对象） |
| `create` / `delete` | create / delete | `ref`、`ref_type` |
| `pusher` / `before` / `after` | push | 推送者、前后 SHA |

事件 payload 的字段以 GitHub 文档为准；本文只承诺这些别名存在，不承诺裁剪掉原始字段。原始 payload 仍可通过 `event.*` 读取，但仍受“不暴露 secrets”的安全边界限制。

## 6. 限制与错误

| 限制 | 值 |
| --- | --- |
| 渲染深度 | 20 |
| 展开节点总数 | 10000 |
| 单次 `$each` 最多迭代 | 100 |
| 模板文件 | 5MB |
| YAML 别名 | 100 |
| `payload` 输出 | 64KB（超出截断并标记） |

常见错误：

- `E_TEMPLATE_EXPR`：`{{` 未闭合、未知字符、非法路径或空表达式。
- `E_TEMPLATE_FILTER`：未知过滤器或过滤器参数不合法。
- `E_TEMPLATE_RENDER`：`$each` 源不是数组、`$limit` 非法、`$as` 非法、`$prefix` 没有 `$join`、未知 `$` 指令、深度/节点数超限。

渲染发生在剪空之前；`$if` 为假的对象直接消失，不会被当成空对象。渲染完成后还会做类型归一、字节截断和校验，所以“模板能渲染”不等于“消息一定能发送”。
