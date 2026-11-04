# wecom-notifier

Send GitHub repository events to a WeCom (WeChat Work) group robot webhook. This is a **GitHub Composite Action** with zero-config event cards, per-event template files, and full control over the WeCom message body.

[中文](README.md) · [Configuration](docs/configuration.md) · [Templates](docs/templates.md) · [Events](docs/events.md) · [WeCom limits](docs/wecom.md) · [Builder](docs/index.html)

## Features

- **Zero config**: `preset: auto` picks a card for push, pull request, issues, releases, workflow runs, stars, forks, and more.
- **One file per event**: `.github/wecom-notify/wecom-push.yml` only handles `push`; `wecom-pull_request.yml` only handles `pull_request`. No single giant YAML.
- **Three levels of customization**:
  1. Action inputs: `preset: card` plus `title` / `subtitle` / `content` / `info` / `links` / `image-url`.
  2. Repository templates: YAML/JSON with `{{ }}` expressions, `$if`, `$each`, and filters.
  3. Inline `payload`: a complete WeCom message directly in the workflow.
- **All webhook message types**: `text`, `markdown`, `markdown_v2`, `image`, `news`, `file`, `voice`, and `template_card` (`text_notice` / `news_notice`).
- **Validate before sending**: byte limits, required fields, list limits, image MD5, card aspect ratio, and more. Invalid messages are never sent.
- **Safe by default**: the webhook is masked in logs; templates cannot access secrets, tokens, or environment variables; template paths are confined to the workspace.
- **Test locally**: `dry-run`, a CLI, unit tests, and an Action-level smoke test. No webhook needed to render JSON.
- **Visual builder**: a dependency-free [`docs/index.html`](docs/index.html) that exports message JSON/YAML and an Action step.

## Quick start

### 1. Add the webhook secret

In WeCom: group → group robot → copy the webhook URL. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

Name it `WECOM_WEBHOOK` and paste the full URL (`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`). You can also store only the key; the action will use the default API base.

### 2. Add a workflow

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
      # Required only when you use template files under .github/wecom-notify/
      - uses: actions/checkout@v4

      - uses: teriyakiushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
```

> Until the first `v1` tag is published, use `uses: ./` inside this repository or a fork.

With no `preset`, the default is `auto`:

| Event | Default card |
| --- | --- |
| `push` | repository, branch, commit count, recent commits, compare link |
| `pull_request` | PR number/title, author, changes, state |
| `issues` / `issue_comment` | issue/comment summary and link |
| `release` | tag, release name, notes summary |
| `workflow_run` | workflow result, branch, run link |
| `star` / `fork` | new star/fork details |
| `create` / `delete` | branch or tag created/deleted |
| other events | generic markdown with event, repo, actor, and run link |

## One file per event

Put complex customization in `.github/wecom-notify/`, one file per event:

```text
.github/wecom-notify/
├── wecom-push.yml          # push only
├── wecom-pull_request.yml  # pull_request only
├── wecom-release.yml       # release only
└── default.yml            # optional fallback
```

Discovery rules:

1. exact `<event>.yml` / `<event>.yaml`;
2. or suffix match `*-<event>.yml` / `*-<event>.yaml` (for example `wecom-push.yml`);
3. multiple matches for the same event are an error;
4. otherwise `default.yml` / `_default.yml`;
5. otherwise fall back to the built-in preset.

Minimal override for push:

```yaml
# .github/wecom-notify/wecom-push.yml
extends: push
overrides:
  template_card:
    source:
      desc: wecom CI
      desc_color: 1
```

A full custom card for pull requests:

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

> When using template files, run `actions/checkout` first so the runner can read `.github/wecom-notify/`.

## Customize in the workflow

### Simple card

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: card
    title: "🚀 Deployed · {{ repo.name }}"
    subtitle: production
    content: "Version v1.2.3, took 2m13s"
    info: |
      Version: v1.2.3
      Branch: main
      Duration: 2m13s
    links: |
      View run | ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      View commit | ${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}
    link-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

Set `image-url` to switch to a `news_notice` card with a cover image.

### Deep-merge overrides

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: push
    overrides: |
      template_card:
        source:
          desc: My robot
          desc_color: 3
        main_title:
          title: "📦 {{ repo.name }} / {{ ref_name }}"
```

Objects are merged recursively; arrays are replaced; `null` deletes a key; `0`/`false` are preserved.

### Inline complete message

```yaml
- uses: teriyakiushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    payload: |
      msgtype: markdown
      markdown:
        content: |
          ## Build passed ✅
          > Repository: {{ repo.full_name }}
          > Branch: {{ ref_name }}
          > Actor: {{ actor }}
```

Do not set `payload` and `template` at the same time.

## Template syntax at a glance

```yaml
msgtype: template_card
template_card:
  card_type: text_notice
  main_title:
    title: "{{ repo.name }}"
    desc: "{{ event_name }} · {{ actor | default('unknown') }}"

  # swap a whole block by state; untouched fields are inherited
  variants:
    by: workflow_run.conclusion
    cases:
      success: { source: { desc: "passed", desc_color: 3 } }
      failure: { source: { desc: "failed", desc_color: 2 } }
    default: { source: { desc: "running", desc_color: 0 } }

  # kept only when the condition holds; on an array item the row disappears
  horizontal_content_list:
    - when: commit_count > 0
      keyname: Commits
      value: "{{ commit_count }}"

  # iterate an array
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

- Expressions: paths, literals, `==` / `!=` / `>` / `<`, `&&` / `||` / `!`, parentheses, filters.
- Directives: `when` / `$if`, `for` / `$each`, `item` / `$item`, `as` / `$as`, `limit` / `$limit`, `join` / `$join`, `prefix` / `$prefix`, `suffix` / `$suffix`. Both spellings are equivalent and the `$` form keeps working.
- `variants`: `{ by, cases, default }` deep-merges the selected branch onto its siblings; write `null` in a branch to drop a sibling key.
- Filters: `default`, `truncate`, `truncateBytes`, `firstLine`, `oneLine`, `upper` / `lower`, `replace`, `join`, `take` / `skip`, `first` / `last`, `length`, `json`, `urlencode`, `escapeMd`.
- Context: `event`, `event_name`, `actor`, `repo.*`, `github.*`, `ref_name`, `sha`, `short_sha`, `workflow`, `run_id`, `run_url`, `now`, `vars.*`, `commits`, `pr`, `issue`, `release`, `workflow_run`, and more. **No secrets, token, env, or inputs.**
- Limits: depth 20, 10,000 nodes, at most 100 items per `for`; template paths must stay inside the workspace.
- Local checks: `npm run dev -- --dry-run --html preview.html ...` writes a visual preview; `npm run lint:templates` renders the templates under `examples/` and reports errors and over-long fields.

See [docs/templates.md](docs/templates.md) for the full syntax and context table.

## Inputs and outputs

Common inputs:

| Input | Default | Description |
| --- | --- | --- |
| `webhook` | empty (dry-run only) | Full webhook URL or key only; use a secret |
| `preset` | `auto` | `auto`, an event name, `text`, `markdown`, `card`, or `none` |
| `payload` | empty | inline YAML/JSON message or config |
| `template` | empty | explicit template file; wins over `template-dir` |
| `template-dir` | `.github/wecom-notify` | per-event discovery directory; empty disables it |
| `overrides` | empty | YAML/JSON deep-merge patch |
| `vars` | empty | YAML/JSON variables exposed as `vars.*` |
| `dry-run` | `false` | render and validate without sending |
| `fail-on-error` | `true` | fail the step on validation/send errors |
| `auto-truncate` | `true` | truncate hard text/markdown/news byte limits |
| `timeout` / `retries` | `10` / `2` | request timeout and retry count |
| `api-base` | `https://qyapi.weixin.qq.com` | API base when `webhook` is only a key |
| `debug` | `false` | extra diagnostics without secrets |
| `html` | empty | During dry-run, also write a self-contained HTML preview to this path |

Outputs: `msgtype`, `payload` (rendered JSON, up to 64KB), `errcode`, `errmsg`.

See [docs/configuration.md](docs/configuration.md) for the full input table, source precedence, and config document format.

## WeCom limits

- At most **20 messages per minute** per webhook; `45009` is retried with backoff.
- `text.content` ≤ 2048 bytes; `markdown` / `markdown_v2` ≤ 4096 bytes.
- `news.articles` 1–8; title ≤ 128 bytes; description ≤ 512 bytes.
- A `text_notice` card needs `main_title.title` or `sub_title_text`, and `card_action` is required.
- Card images must be public URLs reachable by WeCom. `image` messages may embed base64 (≤ 2MB, JPG/PNG).
- `file` / `voice` only pass through a `media_id`; upload it with WeCom `upload_media` first. A media ID is valid for 3 days and only for the same webhook.

See [docs/wecom.md](docs/wecom.md) and the official [91770](https://developer.work.weixin.qq.com/document/path/91770).

## Security

- Treat the webhook URL as a credential. The action masks it immediately and redacts errors.
- Templates cannot access `secrets`, `github.token`, `env`, or action inputs; only the event and explicit `vars`.
- Avoid `pull_request_target` + checking out PR code + secrets. Fork PRs do not receive secrets by default.
- Template files must be inside the workspace and are bounded by size/depth/node limits.
- Invalid messages are never sent. `fail-on-error: false` downgrades failures to warnings.

Report vulnerabilities privately via GitHub Security Advisories; see [SECURITY.md](SECURITY.md).

## Local development

Requires Node.js 18+.

```bash
npm install
npm test
npm run build
npm run build:check

# Render a sample push event without a webhook
node src/cli.mjs --dry-run \
  --event-name push \
  --event tests/fixtures/events/push.json

# Render a simple card
node src/cli.mjs --dry-run --preset card \
  --title "Deployed" --subtitle production \
  --content "Version v1.2.3"
```

```bash
node src/cli.mjs --help
```

`dist/index.mjs` is the bundled Action entry point (esbuild + YAML parser). Rebuild and commit it after changing `src/`.

## Documentation

- [Configuration: inputs, outputs, precedence](docs/configuration.md)
- [Templates: syntax, expressions, directives, context](docs/templates.md)
- [Event presets and examples](docs/events.md)
- [WeCom message types and limits](docs/wecom.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development and release](docs/development.md)
- [Visual builder](docs/index.html)
- [Examples](examples/README.md)

## License

[MIT](LICENSE) © 2026 teriyakiushi
