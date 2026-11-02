# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/teriyakiushi/dmao-wecom-notifier/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/teriyakiushi/dmao-wecom-notifier/releases/tag/v0.1.0
