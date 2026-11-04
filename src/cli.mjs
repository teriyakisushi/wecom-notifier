#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { main } from './index.mjs';
import { ConfigError } from './errors.mjs';

const VALUE_OPTIONS = new Set([
  'webhook',
  'preset',
  'payload',
  'template',
  'template-dir',
  'overrides',
  'vars',
  'title',
  'subtitle',
  'content',
  'info',
  'links',
  'link-url',
  'link-title',
  'image-url',
  'source',
  'source-icon',
  'source-color',
  'timeout',
  'retries',
  'api-base',
  'html',
  'event',
  'event-name',
]);

const BOOLEAN_OPTIONS = new Set([
  'dry-run',
  'fail-on-error',
  'auto-truncate',
  'debug',
  'help',
  'version',
]);

function camelFlag(name) {
  return name.replace(/-([a-z])/gu, (_match, char) => char.toUpperCase());
}

function parseArgv(argv) {
  const cli = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--') break;
    if (!raw.startsWith('--')) {
      throw new ConfigError(`Unexpected argument: ${raw}`, {
        code: 'E_CLI_ARGUMENT',
        hint: 'Use --help to see the supported options.',
      });
    }

    let name = raw.slice(2);
    let value;
    const equals = name.indexOf('=');
    if (equals !== -1) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    }

    const negated = name.startsWith('no-');
    const baseName = negated ? name.slice(3) : name;
    if (!VALUE_OPTIONS.has(baseName) && !BOOLEAN_OPTIONS.has(baseName)) {
      throw new ConfigError(`Unknown option: --${name}`, {
        code: 'E_CLI_OPTION',
        hint: 'Use --help to see the supported options.',
      });
    }

    if (BOOLEAN_OPTIONS.has(baseName)) {
      if (value !== undefined) {
        cli[camelFlag(baseName)] = value === 'true';
      } else if (negated) {
        cli[camelFlag(baseName)] = false;
      } else if (baseName.startsWith('no-')) {
        cli[camelFlag(baseName.slice(3))] = false;
      } else {
        cli[camelFlag(baseName)] = true;
      }
      continue;
    }

    if (value === undefined) {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw new ConfigError(`Option --${name} needs a value`, {
          code: 'E_CLI_ARGUMENT',
        });
      }
      value = argv[index];
    }
    cli[camelFlag(baseName)] = value;
  }

  if (cli.event !== undefined && cli.eventPath === undefined) {
    cli.eventPath = cli.event;
    delete cli.event;
  }
  if (cli.eventName !== undefined) {
    cli.eventName = String(cli.eventName);
  }
  return cli;
}

function version() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function help() {
  return `wecom-notifier ${version()}

Usage:
  node src/cli.mjs --webhook <url> [options]
  node src/cli.mjs --dry-run --event tests/fixtures/events/push.json

Core options:
  --webhook <url|key>       WeCom group robot webhook URL or key (or INPUT_WEBHOOK)
  --preset <name>           auto | event preset | text | markdown | card | none
  --payload <yaml|json>     Inline message/config document
  --template <file>         Explicit template file (relative to the workspace)
  --template-dir <dir>      Per-event template directory (default .github/wecom-notify)
  --overrides <yaml|json>   Deep-merge patch
  --vars <yaml|json>        Template variables
  --title/--subtitle/--content/--info/--links/--link-url/--link-title/--image-url
                            Flat card fields
  --source/--source-icon/--source-color
                            Card source fields
  --dry-run                 Render and validate, do not send
  --fail-on-error <bool>    Exit non-zero on validation/send errors (default true)
  --auto-truncate <bool>    Truncate hard text/news limits (default true)
  --timeout <seconds>       Request timeout, 1-60 (default 10)
  --retries <n>             Retries for network/5xx/45009, 0-5 (default 2)
  --api-base <url>          Gateway base URL when webhook is a bare key
  --debug                   Extra non-secret diagnostics

Local event options:
  --event <file>            JSON event payload (or GITHUB_EVENT_PATH)
  --event-name <name>       Event name (or GITHUB_EVENT_NAME)

Other:
  --help                    Show this help
  --version                 Print the version

Environment variables:
  INPUT_WEBHOOK, INPUT_PRESET, ... and WECOM_INPUTS are also supported.
  In GitHub Actions the Action reads its inputs from WECOM_INPUTS.
`;
}

async function run() {
  let cli;
  try {
    cli = parseArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (cli.help) {
    process.stdout.write(help());
    return;
  }
  if (cli.version) {
    process.stdout.write(`${version()}\n`);
    return;
  }

  await main({ cli });
}

run().catch((error) => {
  process.stderr.write(`${error?.stack ?? String(error)}\n`);
  process.exitCode = 1;
});
