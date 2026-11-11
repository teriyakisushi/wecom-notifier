#!/usr/bin/env node
/**
 * examples/custom 模板预览器（非交互）：挑模板 → 渲染 → 可选真发。
 *
 *   node scripts/preview-custom.mjs                          # 全部模板，dry-run
 *   node scripts/preview-custom.mjs ci                       # 按名字片段挑
 *   node scripts/preview-custom.mjs ci --send                # 真发
 *   node scripts/preview-custom.mjs --conclusion success     # 看“绿了”那张卡
 *   node scripts/preview-custom.mjs --list                   # 列出模板与推断出的事件
 *
 * 想要菜单式选择：`npm run preview:i`（scripts/preview-interactive.mjs）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_PREVIEW_DIR,
  ROOT,
  describe,
  listTemplates,
  pick,
  renderOne,
  resolveWebhook,
  eventFor,
} from './lib/custom-preview.mjs';

function parseArgs(argv) {
  const options = {
    send: false,
    list: false,
    payload: false,
    help: false,
    event: undefined,
    fixture: undefined,
    conclusion: undefined,
    status: undefined,
    htmlDir: DEFAULT_PREVIEW_DIR,
    names: [],
  };
  const valueFlags = new Set(['event', 'fixture', 'conclusion', 'status', 'html']);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('-')) {
      options.names.push(raw);
      continue;
    }
    let name = raw.replace(/^--/u, '');
    let value;
    const equals = name.indexOf('=');
    if (equals !== -1) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    }
    if (name === 'help' || name === 'h') { options.help = true; continue; }
    if (name === 'send') { options.send = true; continue; }
    if (name === 'list') { options.list = true; continue; }
    if (name === 'payload') { options.payload = true; continue; }
    if (!valueFlags.has(name)) throw new Error(`Unknown option: --${name}`);
    if (value === undefined) {
      index += 1;
      if (index >= argv.length) throw new Error(`Option --${name} needs a value`);
      value = argv[index];
    }
    if (name === 'html') options.htmlDir = path.resolve(ROOT, value);
    else options[name] = value;
  }
  return options;
}

const HELP = `用法: node scripts/preview-custom.mjs [模板名...] [选项]

不写模板名就跑 examples/custom 下的全部模板；名字可以是片段（ci、push、workflow_run）。
交互式版本：npm run preview:i

选项:
  --send              真发到企业微信（默认只 dry-run + 写 HTML 预览）
  --event <name>      覆盖事件名（默认按文件名推断）
  --fixture <file>    覆盖事件 JSON
  --conclusion <v>    改 workflow_run.conclusion，看别的分支（success/failure/cancelled...）
  --status <v>        改 workflow_run.status（in_progress/queued/completed）
  --html <dir>        HTML 预览目录（默认 .research/tmp）
  --payload           打印渲染后的 JSON
  --list              列出模板与推断出的事件
  --help              这段帮助`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }

  const files = listTemplates();
  if (!files.length) throw new Error(`examples/custom 下没有模板文件`);
  if (options.list) {
    for (const file of files) console.log(`${path.basename(file).padEnd(28)} [${eventFor(file)}]`);
    return;
  }

  const targets = pick(files, options.names);
  const webhook = resolveWebhook();
  if (options.send && !webhook.value) {
    throw new Error('真发需要 webhook：在 .env 里写 WECOM_WEBHOOK，或导出 INPUT_WEBHOOK / WECOM_WEBHOOK');
  }
  console.log(
    options.send
      ? `真发 ${targets.length} 个模板 → 企业微信（webhook 来自 ${webhook.origin}）`
      : `dry-run ${targets.length} 个模板，HTML 预览写到 ${path.relative(ROOT, options.htmlDir) || '.'}`,
  );

  const outputFile = path.join(mkdtempSync(path.join(tmpdir(), 'wecom-output-')), 'github_output');
  writeFileSync(outputFile, '');
  let failures = 0;
  try {
    for (const file of targets) {
      try {
        const rendered = await renderOne(file, options, { webhook: options.send ? webhook.value : '', outputFile });
        console.log(describe(rendered));
        if (options.payload) console.log(rendered.result.payload);
        if (!rendered.result.ok) failures += 1;
      } catch (error) {
        failures += 1;
        const code = error?.code ? `${error.code}: ` : '';
        console.error(`✗ ${path.basename(file)} — ${code}${error?.message ?? error}`);
        if (error?.issues) for (const issue of error.issues) console.error(`    ${issue.code}: ${issue.message}`);
      }
    }
  } finally {
    rmSync(path.dirname(outputFile), { recursive: true, force: true });
  }

  console.log(failures ? `\n${targets.length - failures} 成功 / ${failures} 失败` : `\n${targets.length} 个模板全部成功`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 2;
}
