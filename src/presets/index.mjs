import { ConfigError } from '../errors.mjs';
import { isHttpUrl } from '../util.mjs';
import {
  fitBlock,
  fitText,
  fitTitle,
  makeAction,
  makeHorizontalList,
  makeJumpList,
  makeNewsNotice,
  makeSource,
  makeTextNotice,
  parseInfoInput,
  parseLinksInput,
  quoteArea,
  requireHttpUrl,
} from './helpers.mjs';

const GITHUB = 'GitHub';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstHttp(...values) {
  for (const value of values) {
    if (isHttpUrl(value)) return value;
  }
  return undefined;
}

function repoName(ctx) {
  return ctx.repo?.full_name || ctx.repo?.name || GITHUB;
}

function actorName(ctx) {
  return ctx.actor || ctx.sender?.login || '有人';
}

function eventUrl(ctx, ...preferred) {
  const primary = firstNonEmpty(...preferred);
  const fallback = firstHttp(ctx.detail_url, ctx.repo?.html_url);
  return requireHttpUrl(primary, 'card_action.url', fallback);
}

function jumps(items) {
  return makeJumpList(
    items.filter((item) => item && item.title && (isHttpUrl(item.url) || (item.appid && item.pagepath))),
  );
}

function hList(items) {
  return makeHorizontalList(items);
}

function source(ctx, desc = GITHUB, color = 0) {
  return makeSource({ desc, color });
}

function textCard(ctx, { sourceDesc, sourceColor, title, desc, emphasis, quote, subTitle, horizontal, jump, actionUrl }) {
  return makeTextNotice({
    source: source(ctx, sourceDesc, sourceColor),
    title: fitTitle(title),
    desc: fitText(desc, 30),
    emphasis,
    quote,
    subTitle: subTitle === undefined ? undefined : fitBlock(subTitle, 112),
    horizontal,
    jump,
    action: makeAction(eventUrl(ctx, actionUrl)),
  });
}

/* ---------------------------------------------------------------- push */

function pushPreset(ctx) {
  const event = ctx.event ?? {};
  const repo = repoName(ctx);
  const actor = actorName(ctx);
  const branch = ctx.ref_name || event.ref || '分支';
  const deleted = event.deleted === true;
  const count = Number(ctx.commit_count) || 0;
  const commits = Array.isArray(ctx.commits) ? ctx.commits : [];

  let subTitle = '';
  if (deleted) {
    subTitle = '分支已被删除';
  } else if (count === 0) {
    subTitle = '没有新的提交';
  } else {
    const lines = commits
      .slice(0, 3)
      .map((commit) => `• ${fitText(commit.first_line || commit.one_line || commit.id || '', 80)}`)
      .filter((line) => line !== '• ');
    subTitle = lines.join('\n');
    if (count > 3) subTitle += `\n… 另有 ${count - 3} 个提交`;
  }

  return textCard(ctx, {
    sourceDesc: 'GitHub',
    title: deleted ? `🗑️ ${repo}` : `📦 ${repo}`,
    desc: deleted ? `${actor} 删除了 ${branch}` : `${actor} 推送到 ${branch}`,
    emphasis: !deleted && count > 0 ? { title: fitText(String(count), 10), desc: '个新提交' } : undefined,
    subTitle,
    horizontal: hList([
      { keyname: '仓库', value: repo },
      { keyname: '分支', value: branch },
      { keyname: '提交', value: `${count} 个` },
    ]),
    jump: jumps([
      { title: '查看对比', url: ctx.compare_url },
      { title: '仓库', url: ctx.repo?.html_url },
    ]),
    actionUrl: ctx.compare_url ?? ctx.commit_url,
  });
}

/* -------------------------------------------------------- pull_request */

const PR_ACTIONS = {
  opened: '新开',
  reopened: '重新打开',
  closed: '关闭',
  synchronize: '更新代码',
  edited: '编辑',
  ready_for_review: '可评审',
  converted_to_draft: '转为草稿',
  review_requested: '请求评审',
  labeled: '添加标签',
  unlabeled: '移除标签',
  assigned: '指派',
  unassigned: '取消指派',
};

function pullRequestPreset(ctx) {
  const pr = ctx.pr ?? {};
  const number = pr.number ?? ctx.event?.number ?? '';
  const title = pr.title || '(无标题)';
  const author = pr.user?.login || actorName(ctx);
  const merged = Boolean(pr.merged || pr.merged_at);
  const state = merged ? '已合并' : pr.state === 'closed' ? '已关闭' : pr.draft ? '草稿' : '待审阅';
  const action = PR_ACTIONS[ctx.event_action] || '更新';
  const icon = merged ? '🎉' : pr.state === 'closed' ? '❌' : pr.draft ? '📝' : '🔀';
  const emphasis =
    Number.isFinite(pr.additions) || Number.isFinite(pr.deletions)
      ? { title: fitText(`+${pr.additions ?? 0}`, 10), desc: fitText(`-${pr.deletions ?? 0}`, 15) }
      : undefined;

  return textCard(ctx, {
    sourceDesc: 'GitHub PR',
    sourceColor: merged ? 3 : pr.state === 'closed' ? 2 : 0,
    title: `${icon} #${number} ${title}`,
    desc: `${author} · ${state} · ${action}`,
    emphasis,
    quote: pr.body ? quoteArea(pr.body) : undefined,
    horizontal: hList([
      { keyname: '状态', value: state },
      { keyname: '分支', value: `${pr.base?.ref ?? '?'} ← ${pr.head?.ref ?? '?'}` },
      { keyname: '文件', value: `${pr.changed_files ?? 0} 个` },
    ]),
    jump: jumps([{ title: '查看 PR', url: pr.html_url }]),
    actionUrl: pr.html_url,
  });
}

/* ------------------------------------------------------------- issues */

const ISSUE_ACTIONS = {
  opened: '新开',
  reopened: '重新打开',
  closed: '关闭',
  edited: '编辑',
  deleted: '删除',
  transferred: '转移',
  pinned: '置顶',
  unpinned: '取消置顶',
  assigned: '指派',
  unassigned: '取消指派',
  labeled: '加标签',
  unlabeled: '移除标签',
  milestoned: '设里程碑',
  demilestoned: '移除里程碑',
};

function issuesPreset(ctx) {
  const issue = ctx.issue ?? {};
  const number = issue.number ?? ctx.event?.number ?? '';
  const title = issue.title || '(无标题)';
  const author = issue.user?.login || actorName(ctx);
  const state = issue.state === 'closed' ? '已关闭' : '打开';
  const action = ISSUE_ACTIONS[ctx.event_action] || '更新';
  const labels = (issue.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter(Boolean)
    .join('、');
  const assignee =
    (issue.assignees ?? []).map((user) => user?.login).filter(Boolean).join('、') ||
    issue.assignee?.login ||
    '无';

  return textCard(ctx, {
    sourceDesc: 'GitHub Issue',
    sourceColor: issue.state === 'closed' ? 2 : 0,
    title: `${issue.state === 'closed' ? '✅' : '🐛'} #${number} ${title}`,
    desc: `${author} · ${state} · ${action}`,
    quote: issue.body ? quoteArea(issue.body) : undefined,
    horizontal: hList([
      { keyname: '状态', value: state },
      { keyname: '标签', value: labels || '无' },
      { keyname: '指派', value: assignee },
    ]),
    jump: jumps([{ title: '查看 Issue', url: issue.html_url }]),
    actionUrl: issue.html_url,
  });
}

/* ------------------------------------------------------ issue_comment */

const COMMENT_ACTIONS = { created: '新评论', edited: '编辑评论', deleted: '删除评论' };

function issueCommentPreset(ctx) {
  const issue = ctx.issue ?? {};
  const comment = ctx.comment ?? {};
  const author = comment.user?.login || actorName(ctx);
  const kind = issue.pull_request ? 'PR' : 'Issue';
  const action = COMMENT_ACTIONS[ctx.event_action] || '评论';
  const number = issue.number ?? '';

  return textCard(ctx, {
    sourceDesc: 'GitHub 评论',
    title: `💬 #${number} ${issue.title || '(无标题)'}`,
    desc: `${author} 在 ${kind} 中${action}`,
    quote: comment.body ? quoteArea(comment.body) : undefined,
    horizontal: hList([
      { keyname: '类型', value: kind },
      { keyname: '仓库', value: repoName(ctx) },
      { keyname: '评论', value: comment.id ? `#${comment.id}` : '新评论' },
    ]),
    jump: jumps([{ title: '查看评论', url: comment.html_url ?? issue.html_url }]),
    actionUrl: comment.html_url ?? issue.html_url,
  });
}

/* ------------------------------------------------------------ release */

const RELEASE_ACTIONS = {
  published: '已发布',
  unpublished: '取消发布',
  created: '已创建',
  edited: '已编辑',
  deleted: '已删除',
  prereleased: '预发布',
  released: '正式发布',
};

function releasePreset(ctx) {
  const release = ctx.release ?? {};
  const tag = release.tag_name || 'release';
  const name = release.name || tag;
  const author = release.author?.login || actorName(ctx);
  const action = RELEASE_ACTIONS[ctx.event_action] || '发布';
  const prerelease = Boolean(release.prerelease);
  const assets = Array.isArray(release.assets) ? release.assets.length : 0;

  return textCard(ctx, {
    sourceDesc: 'Release',
    sourceColor: prerelease ? 1 : 3,
    title: `🚀 ${tag}`,
    desc: `${name} · ${author} · ${action}`,
    quote: release.body ? quoteArea(release.body) : undefined,
    horizontal: hList([
      { keyname: '标签', value: tag },
      { keyname: '预发布', value: prerelease ? '是' : '否' },
      { keyname: '资产', value: `${assets} 个` },
    ]),
    jump: jumps([{ title: '查看 Release', url: release.html_url }]),
    actionUrl: release.html_url,
  });
}

/* ------------------------------------------------------- workflow_run */

const WORKFLOW_LABELS = {
  success: '成功',
  failure: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  timed_out: '超时',
  action_required: '需操作',
  neutral: '中性',
  stale: '过期',
  startup_failure: '启动失败',
  completed: '已完成',
  queued: '排队中',
  in_progress: '进行中',
  requested: '已请求',
  waiting: '等待中',
  pending: '等待中',
};

const WORKFLOW_ICONS = {
  success: '✅',
  failure: '❌',
  cancelled: '⏹️',
  skipped: '⏭️',
  timed_out: '⌛',
  action_required: '⚠️',
};

function workflowRunPreset(ctx) {
  const run = ctx.workflow_run ?? {};
  const name = run.name || ctx.workflow || 'Workflow';
  const conclusion = run.conclusion || run.status || 'unknown';
  const label = WORKFLOW_LABELS[conclusion] || conclusion;
  const icon = WORKFLOW_ICONS[conclusion] || '⚙️';
  const branch = run.head_branch || ctx.ref_name || '未知分支';
  const event = run.event || ctx.event_name || 'event';
  const color = conclusion === 'success' ? 3 : ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(conclusion) ? 2 : 1;

  return textCard(ctx, {
    sourceDesc: 'Actions',
    sourceColor: color,
    title: `${icon} ${name}`,
    desc: `${branch} · ${event}`,
    emphasis: { title: fitText(label, 10), desc: '工作流结果' },
    horizontal: hList([
      { keyname: '分支', value: branch },
      { keyname: '事件', value: event },
      { keyname: '状态', value: label },
    ]),
    jump: jumps([{ title: '查看运行', url: run.html_url ?? ctx.run_url }]),
    actionUrl: run.html_url ?? ctx.run_url,
  });
}

/* --------------------------------------------------------------- star */

function starPreset(ctx) {
  const created = ctx.event_action !== 'deleted';
  const count = ctx.repo?.stargazers_count ?? 0;

  return textCard(ctx, {
    sourceDesc: 'GitHub Star',
    sourceColor: created ? 3 : 2,
    title: created ? '⭐ 收到新 Star' : '💔 Star 被取消',
    desc: created ? `${actorName(ctx)} Star 了仓库` : `${actorName(ctx)} 取消了 Star`,
    emphasis: { title: fitText(String(count), 10), desc: 'Stars' },
    subTitle: ctx.repo?.description || '',
    horizontal: hList([
      { keyname: '仓库', value: repoName(ctx) },
      { keyname: 'Stars', value: String(count) },
    ]),
    jump: jumps([{ title: '查看仓库', url: ctx.repo?.html_url }]),
    actionUrl: ctx.repo?.html_url,
  });
}

/* --------------------------------------------------------------- fork */

function forkPreset(ctx) {
  const forkee = ctx.event?.forkee ?? {};
  const newRepo = forkee.full_name || repoName(ctx);

  return textCard(ctx, {
    sourceDesc: 'GitHub Fork',
    title: '🍴 仓库被 Fork',
    desc: `${actorName(ctx)} Fork 了仓库`,
    quote: forkee.description ? quoteArea(forkee.description) : undefined,
    horizontal: hList([
      { keyname: '原仓库', value: repoName(ctx) },
      { keyname: '新仓库', value: newRepo },
    ]),
    jump: jumps([{ title: '查看新仓库', url: forkee.html_url }]),
    actionUrl: forkee.html_url ?? ctx.repo?.html_url,
  });
}

/* ------------------------------------------------------------- create */

function createPreset(ctx) {
  const event = ctx.event ?? {};
  const refType = event.ref_type || ctx.ref_type || 'ref';
  const isTag = refType === 'tag';
  const ref = event.ref || ctx.ref_name || '';

  return textCard(ctx, {
    sourceDesc: 'GitHub',
    sourceColor: 3,
    title: `🌿 新建${isTag ? '标签' : '分支'}`,
    desc: `${actorName(ctx)} 创建了 ${ref}`,
    horizontal: hList([
      { keyname: '仓库', value: repoName(ctx) },
      { keyname: '类型', value: refType },
      { keyname: '引用', value: ref },
    ]),
    jump: jumps([{ title: '查看引用', url: ctx.detail_url }]),
    actionUrl: ctx.detail_url,
  });
}

/* ------------------------------------------------------------- delete */

function deletePreset(ctx) {
  const event = ctx.event ?? {};
  const refType = event.ref_type || ctx.ref_type || 'ref';
  const isTag = refType === 'tag';
  const ref = event.ref || ctx.ref_name || '';

  return textCard(ctx, {
    sourceDesc: 'GitHub',
    sourceColor: 2,
    title: `🗑️ 删除${isTag ? '标签' : '分支'}`,
    desc: `${actorName(ctx)} 删除了 ${ref}`,
    horizontal: hList([
      { keyname: '仓库', value: repoName(ctx) },
      { keyname: '类型', value: refType },
      { keyname: '引用', value: ref },
    ]),
    jump: jumps([{ title: '查看仓库', url: ctx.repo?.html_url }]),
    actionUrl: ctx.repo?.html_url,
  });
}

/* ------------------------------------------------------------ generic */

function genericPreset(ctx) {
  const repo = repoName(ctx);
  const lines = [
    `### 📣 ${repo}`,
    '',
    `> 事件：\`${ctx.event_name || 'unknown'}\`${ctx.event_action ? ` · \`${ctx.event_action}\`` : ''}`,
    `> 触发者：${actorName(ctx)}`,
  ];
  if (ctx.ref_name) lines.push(`> 引用：\`${ctx.ref_name}\``);
  const url = firstHttp(ctx.run_url, ctx.detail_url, ctx.repo?.html_url);
  if (url) lines.push('', `[查看详情](${url})`);
  return { msgtype: 'markdown', markdown: { content: lines.join('\n').trim() } };
}

/* ---------------------------------------------------- simple presets */

function simplePreset(type, inputs) {
  const content = String(inputs.content ?? '').trim();
  if (!content) {
    throw new ConfigError(`preset "${type}" requires the "content" input`, {
      code: 'E_PRESET_CONTENT',
      path: 'content',
      hint: `Set content: with the ${type} message body.`,
    });
  }
  return { msgtype: type, [type]: { content } };
}

function textPreset(ctx, inputs) {
  return simplePreset('text', inputs);
}

function markdownPreset(ctx, inputs) {
  return simplePreset('markdown', inputs);
}

/* -------------------------------------------------------------- card */

function cardPreset(ctx, inputs) {
  const repo = repoName(ctx);
  const title = fitTitle(inputs.title || repo);
  const subtitle = fitText(inputs.subtitle || '', 30);
  const content = fitBlock(inputs.content || '', 112);
  const info = parseInfoInput(inputs.info);
  const links = parseLinksInput(inputs.links);
  const actionUrl = requireHttpUrl(
    inputs.linkUrl,
    'link-url',
    firstHttp(links?.[0]?.url, ctx.detail_url, ctx.repo?.html_url),
  );
  const action = makeAction(actionUrl);
  const source = makeSource({
    desc: inputs.source || GITHUB,
    color: inputs.sourceColor,
    icon: inputs.sourceIcon,
  });

  let jump = links ? jumps(links) : [];
  if (!jump.length && inputs.linkUrl) {
    jump = jumps([{ title: inputs.linkTitle || '查看详情', url: inputs.linkUrl }]);
  }
  if (jump.length > 3) jump = jump.slice(0, 3);

  if (inputs.imageUrl) {
    const imageTextArea = {
      type: 1,
      url: actionUrl,
      image_url: inputs.imageUrl,
      title,
      desc: content || subtitle || undefined,
    };
    return makeNewsNotice({
      source,
      title,
      desc: subtitle || undefined,
      imageUrl: inputs.imageUrl,
      imageTextArea,
      horizontal: info ? hList(info) : undefined,
      jump,
      action,
    });
  }

  return makeTextNotice({
    source,
    title,
    desc: subtitle || undefined,
    subTitle: content || undefined,
    horizontal: info ? hList(info) : undefined,
    jump,
    action,
  });
}

/* -------------------------------------------------------------- none */

function nonePreset() {
  return {};
}

/* ----------------------------------------------------------- registry */

export const AUTO_EVENT_PRESETS = Object.freeze({
  push: 'push',
  pull_request: 'pull_request',
  pull_request_target: 'pull_request',
  issues: 'issues',
  issue_comment: 'issue_comment',
  release: 'release',
  workflow_run: 'workflow_run',
  watch: 'star',
  star: 'star',
  fork: 'fork',
  create: 'create',
  delete: 'delete',
});

export const BUILTIN_PRESETS = Object.freeze({
  push: pushPreset,
  pull_request: pullRequestPreset,
  issues: issuesPreset,
  issue_comment: issueCommentPreset,
  release: releasePreset,
  workflow_run: workflowRunPreset,
  star: starPreset,
  fork: forkPreset,
  create: createPreset,
  delete: deletePreset,
  generic: genericPreset,
  text: textPreset,
  markdown: markdownPreset,
  card: cardPreset,
  none: nonePreset,
});

export const PRESET_NAMES = Object.freeze(['auto', ...Object.keys(BUILTIN_PRESETS)]);

export function resolvePresetName(name, eventName) {
  const requested = String(name ?? 'auto').trim() || 'auto';
  if (requested === 'auto') {
    return AUTO_EVENT_PRESETS[eventName] ?? 'generic';
  }
  if (Object.hasOwn(BUILTIN_PRESETS, requested)) return requested;
  throw new ConfigError(`Unknown preset "${requested}"`, {
    code: 'E_PRESET_UNKNOWN',
    path: 'extends',
    hint: `Use one of: ${PRESET_NAMES.join(', ')}`,
  });
}

export function getPreset(name, { ctx, inputs = {}, eventName } = {}) {
  if (!ctx || typeof ctx !== 'object') {
    throw new ConfigError('A template context is required to build a preset', {
      code: 'E_PRESET_CONTEXT',
      path: 'preset',
    });
  }
  const resolved = resolvePresetName(name, eventName ?? ctx.event_name);
  const preset = BUILTIN_PRESETS[resolved];
  return preset(ctx, inputs);
}

/**
 * A short human-readable label for the resolved preset, useful in logs.
 */
export function describePreset(name, eventName) {
  const resolved = resolvePresetName(name, eventName);
  return resolved === name ? resolved : `${name} -> ${resolved}`;
}
