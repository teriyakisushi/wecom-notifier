# Contributing

Thanks for improving `dmao-wecom-notifier`. This is a small, dependency-light
Composite Action; please keep changes focused and testable.

## Setup

```bash
git clone https://github.com/teriyakiushi/dmao-wecom-notifier.git
cd dmao-wecom-notifier
npm install
```

Requires Node.js 18 or newer. The runtime is a single bundled file,
`dist/index.mjs`; source lives in `src/`.

## Development loop

```bash
npm test                 # node:test, no network
npm run build            # rebuild dist/index.mjs
npm run build:check      # verify dist/ is up to date
node src/cli.mjs --help  # local CLI
```

Use a real event fixture when changing context or presets:

```bash
node src/cli.mjs --dry-run \
  --event-name pull_request \
  --event tests/fixtures/events/pull_request.json
```

Fixtures live in `tests/fixtures/events/`. Keep them small and anonymized; do
not include real tokens, webhook URLs, or private repository data.

## Pull requests

- Explain the user-visible behavior change and the event/template case it fixes.
- Add or update tests under `test/`.
- Run `npm test` and `npm run build:check`. If you changed `src/`, commit the
  rebuilt `dist/index.mjs` in the same PR.
- Update the relevant `docs/*.md` and the README when inputs, outputs, limits,
  presets, or template syntax change.
- Keep messages, error codes, and examples in Chinese where the existing
  documentation uses Chinese; English README updates are welcome in parallel.
- Do not add runtime npm dependencies. Build-time dependencies are acceptable
  only when they are bundled into `dist/` and justified.
- Do not commit `.env`, webhook URLs, credentials, or `.research/` notes.

## Commit style

Conventional Commits are appreciated but not required:

```text
feat: add release preset
fix: accept plain horizontal_content_list rows
docs: document per-event template discovery
test: cover 45009 retry
chore: rebuild dist
```

## Security

Please read [SECURITY.md](SECURITY.md) before changing logging, redaction,
template path handling, or the context object. Those are the sensitive parts of
the project.

## License

By contributing, you agree that your contribution is licensed under the MIT
License in [LICENSE](LICENSE).
