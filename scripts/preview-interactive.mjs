#!/usr/bin/env node
/**
 * examples/custom 模板预览器（交互式）：菜单选模板 → 选结论 → 选 dry-run/真发 → 跑完再问一遍。
 *
 *   npm run preview:i
 *
 * 任何提示符下输入 q 退出；直接回车全用括号里的默认值。
 * 真正发送仍然只会用 .env / 环境变量里的 webhook，不进 argv、不打印。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

import {
  DEFAULT_PREVIEW_DIR,
  ROOT,
  describe,
  eventFor,
  listTemplates,
  pick,
  renderOne,
  resolveWebhook,
} from './lib/custom-preview.mjs';

const CONCLUSION_CHOICES = {
  1: { label: 'success      ✅ 绿了', patch: { conclusion: 'success' } },
  2: { label: 'failure      💀 寄了', patch: { conclusion: 'failure' } },
  3: { label: 'cancelled    💤 凉了', patch: { conclusion: 'cancelled' } },
  4: { label: 'timed_out    💤 凉了（超时）', patch: { conclusion: 'timed_out' } },
  5: { label: 'in_progress  🏃 还在跑', patch: { status: 'in_progress' } },
  6: { label: '保持 fixture 原样（failure）', patch: {} },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// stdin 提前关闭（管道、CI）时让挂起的 question 立刻返回 null，而不是吊死进程。
let onEof;
const eof = new Promise((resolve) => { onEof = resolve; });
rl.on('close', () => onEof(null));

rl.on('SIGINT', () => {
  rl.close();
  console.log('\n走了。');
  process.exit(130);
});

/** 空输入 → 默认值；q → 退出（返回 null）。 */
async function ask(prompt, fallback = '') {
  let answer;
  try {
    answer = await Promise.race([rl.question(prompt), eof]);
  } catch {
    return null;
  }
  if (answer === null) return null;
  const text = String(answer).trim();
  if (text === 'q' || text === 'quit' || text === 'exit') return null;
  return text || fallback;
}

function summaryOf(file) {
  const first = readFileSync(file, 'utf8').split(/\r?\n/u)[0] ?? '';
  if (!first.trim().startsWith('#')) return '';
  const text = first.replace(/^\s*#\s*/u, '').replace(/\s*#\s*lint:event.*$/u, '').trim();
  if (!text || /^lint:/u.test(text)) return '';
  return text.length > 34 ? `${text.slice(0, 33)}…` : text;
}

/** 模板里真有 conclusion/status 的分支才值得问“看哪个结论”。 */
function variesByConclusion(file) {
  return /workflow_run\.(?:conclusion|status)\s*==/u.test(readFileSync(file, 'utf8'));
}

async function chooseTemplates(files) {
  console.log('\n模板：');
  files.forEach((file, index) => {
    console.log(`  ${index + 1}) ${path.basename(file).padEnd(26)} [${eventFor(file)}] ${summaryOf(file)}`);
  });
  while (true) {
    const answer = await ask(`\n选择模板 [1-${files.length}, a=全部, q=退出] (1): `, '1');
    if (answer === null) return null;
    if (answer === 'a' || answer === 'all') return files;
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= files.length) return [files[index - 1]];
    try {
      return pick(files, [answer]);
    } catch {
      console.log(`  “${answer}” 对不上，重来。`);
    }
  }
}

async function chooseConclusion() {
  console.log('\n结论（决定哪句台词会出现在卡片里）：');
  for (const [key, choice] of Object.entries(CONCLUSION_CHOICES)) console.log(`  ${key}) ${choice.label}`);
  while (true) {
    const answer = await ask('\n结论 [1-6] (6): ', '6');
    if (answer === null) return null;
    const choice = CONCLUSION_CHOICES[answer];
    if (choice) return choice.patch;
    console.log('  只有 1-6，重来。');
  }
}

async function chooseMode(webhook) {
  console.log('\n发送方式：');
  console.log('  1) dry-run，写 HTML 预览（不发）');
  console.log(`  2) 真发到企业微信${webhook.value ? `（webhook 来自 ${webhook.origin}）` : '（webhook 未配置）'}`);
  while (true) {
    const answer = await ask('\n方式 [1=dry-run 2=真发] (1): ', '1');
    if (answer === null) return null;
    if (answer === '1') return { send: false };
    if (answer === '2') {
      if (!webhook.value) {
        console.log('  没找到 webhook：先在 .env 写 WECOM_WEBHOOK，这次只能 dry-run。');
        return { send: false };
      }
      return { send: true };
    }
    console.log('  输入 1 或 2，重来。');
  }
}

async function main() {
  const files = listTemplates();
  if (!files.length) throw new Error('examples/custom 下没有模板文件');
  const webhook = resolveWebhook();
  const outputFile = path.join(mkdtempSync(path.join(tmpdir(), 'wecom-output-')), 'github_output');
  writeFileSync(outputFile, '');

  console.log('examples/custom 模板预览（q 退出，回车用默认值）');
  try {
    for (;;) {
      const targets = await chooseTemplates(files);
      if (!targets) break;

      let send = false;
      const runs = [];
      for (const file of targets) {
        const eventName = eventFor(file);
        let patch = {};
        if (eventName === 'workflow_run' && variesByConclusion(file)) {
          const chosen = await chooseConclusion();
          if (chosen === null) { send = null; break; }
          patch = chosen;
        }
        runs.push({ file, eventName, patch });
      }
      if (send === null) break;
      if (!runs.length) continue;

      const mode = await chooseMode(webhook);
      if (!mode) break;
      send = mode.send;

      console.log(`\n${send ? '真发' : 'dry-run'} ${runs.length} 个模板…`);
      let failures = 0;
      for (const run of runs) {
        const options = {
          send,
          event: undefined,
          fixture: undefined,
          conclusion: run.patch.conclusion,
          status: run.patch.status,
          htmlDir: DEFAULT_PREVIEW_DIR,
        };
        try {
          const rendered = await renderOne(run.file, options, { webhook: send ? webhook.value : '', outputFile });
          console.log(describe(rendered));
          if (!rendered.result.ok) failures += 1;
        } catch (error) {
          failures += 1;
          console.error(`✗ ${path.basename(run.file)} — ${error?.code ? `${error.code}: ` : ''}${error?.message ?? error}`);
          for (const issue of error?.issues ?? []) console.error(`    ${issue.code}: ${issue.message}`);
        }
      }
      console.log(failures ? `${runs.length - failures} 成功 / ${failures} 失败` : `${runs.length} 个模板全部成功`);

      const again = await ask('\n回车再跑一次，q 退出: ', '');
      if (again === null) break;
    }
  } finally {
    rmSync(path.dirname(outputFile), { recursive: true, force: true });
    rl.close();
  }
  console.log(`预览文件在 ${path.relative(ROOT, DEFAULT_PREVIEW_DIR)}/ 下。`);
}

try {
  await main();
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 2;
}
