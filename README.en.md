<h1 align="center">wecom-notifier</h1>

<p align="center">Send GitHub repository events to a WeCom (WeChat Work) group robot webhook — a Composite Action with zero runtime dependencies.</p>

<p align="center">
  <a href="https://github.com/teriyakisushi/wecom-notifier/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/teriyakisushi/wecom-notifier/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/teriyakisushi/wecom-notifier/releases"><img alt="Release" src="https://img.shields.io/github/v/release/teriyakisushi/wecom-notifier?label=release"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/teriyakisushi/wecom-notifier"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
</p>

<p align="center">
  <a href="https://teriyakisushi.github.io/wecom-notifier/"><b>🔧 Message builder</b></a> ·
  <a href="docs/">Docs</a> ·
  <a href="examples/">Examples</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="README.md">中文</a>
</p>

```yaml
- uses: teriyakisushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
```

Two lines to wire it up: `push`, pull requests, issues, releases, `workflow_run`, stars, forks and friends become well-formatted WeCom cards. When the defaults are not enough, split templates per event or inline the whole message body.

## Features

- **Works with zero config**: `preset: auto` picks a card from `GITHUB_EVENT_NAME`; no template required.
- **One file per event**: `.github/wecom-notify/wecom-push.yml` only handles `push`, `wecom-pull_request.yml` only handles pull requests — no single giant YAML.
- **Three levels of customization**: Action inputs → repository template files → inline `payload`.
- **All 8 message types**: `text`, `markdown`, `markdown_v2`, `image`, `news`, `file`, `voice`, and `template_card` (`text_notice` / `news_notice`).
- **Validate before sending**: byte limits, required fields, list limits, image MD5 and card aspect ratio are checked first; invalid messages are never sent.
- **Verify offline**: `dry-run`, a CLI, unit tests and an Action-level smoke test render JSON and an HTML preview without a webhook.

## Quick start

### 1. Add the webhook secret

In WeCom: group → group robot → copy the webhook URL. In GitHub:
**Settings → Secrets and variables → Actions → New repository secret**, name it `WECOM_WEBHOOK`.

The value can be the full URL (`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`) or just the key; the action fills in the default API base.

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
      # Only needed when you use templates under .github/wecom-notify/
      - uses: actions/checkout@v4

      - uses: teriyakisushi/wecom-notifier@v1
        with:
          webhook: ${{ secrets.WECOM_WEBHOOK }}
```

> Testing inside this repository or a fork? Change `uses:` to `uses: ./`.

Without `preset`, it defaults to `auto`:

| Event | Default card |
| --- | --- |
| `push` | repository, branch, commit count, latest commit, compare link |
| `pull_request` | PR number/title, author, additions/deletions, state |
| `issues` / `issue_comment` | issue/comment summary and link |
| `release` | tag, release name, notes excerpt |
| `workflow_run` | workflow result, branch, run link |
| `star` / `fork` | new star / fork details |
| `create` / `delete` | branch or tag created/deleted |
| anything else | generic markdown (event, repository, actor, run link) |

## Message builder

No appetite for hand-written card JSON? Use the online builder: **<https://teriyakisushi.github.io/wecom-notifier/>**

- Fill in fields on the left, see a live preview on the right that closely matches the real card;
- Import an existing template and keep editing, or start from **Load example**;
- Export **JSON / YAML / an Action step / a template file** — the exported shape is exactly what the action accepts;
- Pure front end and fully offline (you can also open [`docs/index.html`](docs/index.html) directly); nothing is uploaded, not even the webhook.

## Customize

### One file per event (recommended)

```text
.github/wecom-notify/
├── wecom-push.yml          # only push
├── wecom-pull_request.yml  # only pull_request
├── wecom-release.yml       # only release
└── default.yml             # optional fallback
```

Lookup order:

1. exact `<event>.yml` / `<event>.yaml`;
2. or suffix `*-<event>.yml` / `*-<event>.yaml` (e.g. `wecom-push.yml`);
3. two candidates for the same event is an error;
4. otherwise `default.yml` / `_default.yml`;
5. otherwise the built-in preset.

Smallest possible change — only restyle the source line of the push card:

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
<summary>Complete pull request card</summary>

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
    - keyname: State
      value: "{{ pr.state }}"
    - keyname: From
      value: "{{ pr.head.ref }}"
    - keyname: Into
      value: "{{ pr.base.ref }}"
  card_action:
    type: 1
    url: "{{ pr.html_url }}"
```

</details>

> Templates live in the repository, so the workflow must `actions/checkout` first.
> More cards are in [`examples/`](examples/); `npm run preview` renders them to HTML so you can look before you send.

### Inline in the workflow

**Simple card** (`preset: card`):

```yaml
- uses: teriyakisushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: card
    title: "🚀 Deployed · {{ repo.name }}"
    subtitle: production
    content: "v1.2.3, took 2m13s"
    info: |
      Version: v1.2.3
      Branch: main
      Duration: 2m13s
    links: |
      Run | ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      Commit | ${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}
```

A non-empty `image-url` switches to the `news_notice` card automatically.

**Deep-merge any field** (`overrides`):

```yaml
- uses: teriyakisushi/wecom-notifier@v1
  with:
    webhook: ${{ secrets.WECOM_WEBHOOK }}
    preset: push
    overrides: |
      template_card:
        source:
          desc: my robot
          desc_color: 3
        main_title:
          title: "📦 {{ repo.name }} / {{ ref_name }}"
```

Objects merge key by key, arrays are replaced wholesale, `null` deletes a key, and `0` / `false` are kept.

**Inline complete message** (`payload`):

```yaml
- uses: teriyakisushi/wecom-notifier@v1
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

Do not set `payload` and `template` together; keep one source, or paste the file content into `payload`.

## Template syntax

```yaml
msgtype: template_card
template_card:
  card_type: text_notice
  main_title:
    title: "{{ repo.name }}"
    desc: "{{ event_name }} · {{ actor | default('unknown') }}"

  # Swap a whole block on a value; untouched fields are kept
  variants:
    by: workflow_run.conclusion
    cases:
      success: { source: { desc: "passed", desc_color: 3 } }
      failure: { source: { desc: "failed", desc_color: 2 } }
    default: { source: { desc: "running", desc_color: 0 } }

  # Drop the element when the condition is false
  horizontal_content_list:
    - when: commit_count > 0
      keyname: Commits
      value: "{{ commit_count }}"

  # Loop over an array
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
- Directives: `when` / `$if`, `for` / `$each`, `item` / `$item`, `as` / `$as`, `limit` / `$limit`, `join` / `$join`, `prefix` / `$prefix`, `suffix` / `$suffix`; both spellings are equivalent.
- `variants`: `{ by, cases, default }`; the matching branch deep-merges into the current object, and `null` inside a branch removes a sibling key.
- Filters: `default`, `truncate`, `truncateBytes`, `firstLine`, `oneLine`, `upper` / `lower`, `replace`, `join`, `take` / `skip`, `first` / `last`, `length`, `json`, `urlencode`, `escapeMd`.
- Context: `event`, `event_name`, `actor`, `repo.*`, `github.*`, `ref_name`, `sha`, `short_sha`, `workflow`, `run_id`, `run_url`, `now`, `vars.*`, `commits`, `pr`, `issue`, `release`, `workflow_run`, and more; **never secrets / token / env**.
- Limits: render depth 20, 10000 nodes, at most 100 items per `for`; template paths must stay inside the workspace.

Full syntax, context table and limits: [docs/templates.md](docs/templates.md). Locally, `npm run dev -- --dry-run --html preview.html ...` writes an HTML preview, and `npm run lint:templates` renders everything under `examples/` to catch errors and over-long fields.

## Inputs and outputs

| Input | Default | Description |
| --- | --- | --- |
| `webhook` | empty (fine for dry-run) | full webhook URL or just the key; prefer a secret |
| `preset` | `auto` | `auto` / event name / `text` / `markdown` / `card` / `none` |
| `payload` | empty | inline YAML/JSON message or config |
| `template` | empty | explicit template file; wins over `template-dir` |
| `template-dir` | `.github/wecom-notify` | per-event template directory; empty string disables |
| `overrides` | empty | YAML/JSON deep-merge patch |
| `vars` | empty | YAML/JSON variables exposed as `vars.*` |
| `dry-run` | `false` | render and validate only |
| `fail-on-error` | `true` | fail the step when validation or sending fails |
| `auto-truncate` | `true` | truncate hard byte limits for text/markdown/news |
| `timeout` / `retries` | `10` / `2` | per-request timeout (seconds) and retry count |
| `api-base` | `https://qyapi.weixin.qq.com` | API base used when `webhook` is only a key |
| `debug` | `false` | diagnostics without the key |
| `html` | empty | also write a self-contained HTML preview on dry-run |

Outputs: `msgtype`, `payload` (rendered JSON, up to 64KB), `errcode`, `errmsg`.

Full input table, source precedence and config file format: [docs/configuration.md](docs/configuration.md).

## WeCom limits

- At most **20 messages/minute** per webhook; over the limit you get `45009`, and the action backs off and retries.
- `text.content` ≤ 2048 bytes; `markdown` / `markdown_v2` ≤ 4096 bytes.
- `news.articles` holds 1–8 items; title ≤ 128 bytes, description ≤ 512 bytes.
- A `text_notice` card needs `main_title.title` or `sub_title_text`, and `card_action` is required.
- Card images must be public URLs reachable by WeCom; `image` messages may inline base64 (≤ 2MB, JPG/PNG).
- `file` / `voice` only pass through a `media_id`, uploaded earlier via `upload_media`; it expires in 3 days and is bound to that webhook.

Details: [docs/wecom.md](docs/wecom.md) and the official docs [91770](https://developer.work.weixin.qq.com/document/path/91770).

## Security

- A webhook URL is a credential: never commit it, never log it. The action runs `::add-mask::` on startup and redacts error messages.
- Template context exposes no `secrets`, `github.token`, `env` or Action inputs — only the event and explicit `vars`.
- Avoid `pull_request_target` + checking out PR code + secrets; fork PRs do not get secrets anyway.
- Templates can only read files inside the workspace, with size, depth and node limits.
- Validation failures never send; `fail-on-error: false` downgrades them to warnings.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Local development

Requires Node.js ≥ 18.

```bash
npm ci
npm test                 # unit tests
npm run build            # bundle dist/index.mjs (commit it)
npm run build:check      # dist must match the source

# Render a sample push event without a webhook
node src/cli.mjs --dry-run \
  --event-name push \
  --event tests/fixtures/events/push.json

# Render a simple card
node src/cli.mjs --dry-run --preset card \
  --title "Deployed" --subtitle production \
  --content "v1.2.3"

node src/cli.mjs --help  # all flags
```

`dist/index.mjs` is the esbuild bundle (YAML parser included) and the real entry point of the action, so rebuild and commit it with every source change. Release steps: [docs/development.md](docs/development.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/configuration.md](docs/configuration.md) | inputs, outputs, source precedence |
| [docs/templates.md](docs/templates.md) | template syntax, expressions, directives, context |
| [docs/events.md](docs/events.md) | event presets and customization examples |
| [docs/wecom.md](docs/wecom.md) | WeCom message types and limits |
| [docs/troubleshooting.md](docs/troubleshooting.md) | common errors and fixes |
| [docs/development.md](docs/development.md) | layout, tests, CI and releases |
| [examples/](examples/README.md) | copy-paste cards and workflows |
| [Message builder](https://teriyakisushi.github.io/wecom-notifier/) | assemble messages online, export JSON / YAML |

## Contributing

Issues and PRs are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first and run `npm test`, `npm run lint:templates` and `npm run build:check` before pushing. Security policy: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 teriyakisushi
