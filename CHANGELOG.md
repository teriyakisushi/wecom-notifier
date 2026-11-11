# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Readable directive aliases: `when` / `for` / `item` / `as` / `limit` / `join` /
  `prefix` / `suffix` are equivalent to `$if` / `$each` / `$item` / `$as` /
  `$limit` / `$join` / `$prefix` / `$suffix`. The `$` spelling keeps working, so
  existing templates need no changes.
- `variants` sugar for state-dependent cards: `{ by, cases, default }` deep-merges
  the selected branch onto its siblings (`null` deletes a key) and emits
  `W_VARIANT_UNMATCHED` when nothing matches and no default is declared.
- HTML preview: `--html <file>` (or the `html` input) writes a self-contained page
  with the rendered bubble, validation warnings, and the JSON payload.
- Template lint: `npm run lint:templates` renders every `examples/**/*.yml` against
  a real event fixture and fails on errors (and on warnings with `--strict`).
- Event fixtures for `pull_request`, `workflow_run`, `issues`, `issue_comment`,
  `release`, `star`, `fork`, `create`, and `delete`, plus preset snapshots and an
  auto-preset snapshot per event.
- Coverage gate: `npm run test:coverage` enforces `coverageThreshold` (lines 85 /
  branches 75 / functions 85) using Node's built-in coverage.
- Preview CLI: `npm run preview -- [模板名...]` renders the `examples/custom/`
  cards through the same `runNotify` path the action uses, writes an HTML
  preview, and `--send` posts them to the webhook from `.env` or
  `INPUT_WEBHOOK` (never argv). `--conclusion` / `--status` patch a temporary
  fixture instead of touching `tests/fixtures/`.
- Interactive preview: `npm run preview:i` walks the same flow as a menu —
  template, verdict (only when the card really branches on it), dry-run or
  send — and loops until `q`.
- `examples/custom/wecom-ci-failure.yml`: a failure-only `workflow_run` card,
  meant to sit behind `if: workflow_run.conclusion != 'success'`.

### Changed

- `examples/kawaii/` is replaced by `examples/custom/`, which keeps the push
  card, rewrites the CI card with a conclusion-branching verdict line, and adds
  the failure-only variant.
- `examples/wecom-notify/pr-card.yml` keeps the PR title within the recommended
  26-character card title so the strict template lint stays clean.
- CI now runs `lint:templates` on every Node version, and `build:check` plus the
  coverage gate on Node 22 to catch dist drift early.

## [0.1.0] - 2026-11-02

### Added

- GitHub Composite Action that sends GitHub events to a WeCom group robot
  webhook, with Node.js 18+ and no runtime npm install.
- Built-in Chinese-language presets for `push`, `pull_request`, `issues`,
  `issue_comment`, `release`, `workflow_run`, `star`, `fork`, `create`,
  `delete`, plus `generic`, `text`, `markdown`, `card`, and `none`.
- One-file-per-event template discovery under `.github/wecom-notify/`:
  `<event>.yml`, `*-<event>.yml`, and `default.yml` fallback.
- Template engine with `{{ }}` expressions, `$if`, `$each`, `$item`, `$as`,
  `$limit`, `$join`, `$prefix`, `$suffix`, and filters such as `default`,
  `truncate`, `firstLine`, `join`, `json`, `urlencode`, and `escapeMd`.
- Deep-merge `overrides`, config-level and input-level `vars`, inline `payload`,
  and explicit `template` files.
- Validation and normalization for all eight WeCom webhook message types,
  including image MD5, news article limits, template-card required fields,
  optional row types, and text/markdown byte limits with optional truncation.
- Webhook sending with timeout, retry/backoff for network errors, HTTP 5xx, and
  WeCom `45009`; business errors are not retried.
- GitHub outputs `msgtype`, `payload`, `errcode`, `errmsg`; step summary table;
  webhook masking and log redaction.
- Local CLI, dry-run mode, unit tests, Action-level smoke test, and esbuild
  bundle in `dist/index.mjs`.
- Visual message builder in `docs/index.html` with JSON/YAML export, event
  examples, validation, image MD5 calculation, and an Action step export.

[Unreleased]: https://github.com/teriyakiushi/wecom-notifier/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/teriyakiushi/wecom-notifier/releases/tag/v0.1.0
