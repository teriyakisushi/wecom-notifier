# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository, or contact the maintainer through the address on their
GitHub profile.

Include:

- affected version/commit;
- a minimal reproduction (workflow/template and event payload if possible);
- the impact, especially whether the webhook URL or repository secrets can leak.

You will receive an acknowledgement as soon as possible. Please give us time to
ship a fix before publishing details.

## Supported versions

The latest release tag is supported. This project is small; fixes are normally
released as a new patch/minor tag.

## Security model

- The WeCom webhook URL is a credential. It is masked with `::add-mask::` at
  startup and redacted from logs and error messages.
- Template context is deliberately limited. It does **not** contain secrets,
  `github.token`, environment variables, or action inputs. Only the event
  payload, a safe GitHub metadata subset, and explicit `vars` are exposed.
- Template files must resolve inside `GITHUB_WORKSPACE`. Symlinks are checked
  with `realpath`; path traversal and absolute paths outside the workspace are
  rejected.
- Templates are parsed as YAML/JSON and rendered by a small expression parser.
  `eval`, `new Function`, and arbitrary code execution are not used.
- Rendering has depth, node-count, and iteration limits. YAML aliases are
  limited to 100.
- Invalid messages are never sent. `fail-on-error: false` changes the step
  outcome to a warning, not the validation rules.
- The action does not request or use `GITHUB_TOKEN`; it only needs the
  `webhook` secret and, when templates are used, a checkout of the repository.

## Known operational risks

- **Leaked webhook**: anyone with the URL can post to the group. Revoke/rotate
  the robot webhook in WeCom if it leaks, then update the repository secret.
- **Untrusted PR code**: do not combine `pull_request_target`, checkout of the
  PR head, repository secrets, and template files from the PR. A malicious PR
  could exfiltrate the webhook. Prefer `pull_request` (no secrets for forks) or
  a separate `workflow_run` workflow with a fixed checkout.
- **Message content**: event fields such as issue titles and comments are
  user-controlled. Use `truncate`, `oneLine`, and `escapeMd`, and do not build
  HTML or markdown links from untrusted input without validation.
- **Replay/duplicate messages**: retries are at-least-once. A timeout can occur
  after WeCom accepted the message; retrying may duplicate it.

## Dependency and build integrity

`dist/index.mjs` is generated from `src/` with esbuild. The `yaml` dependency is
bundled into the artifact. CI runs `npm test` and `npm run build:check`; the
latter rebuilds and compares `dist/` byte-for-byte, so a stale artifact fails
the build.
