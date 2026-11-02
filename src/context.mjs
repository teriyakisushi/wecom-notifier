import { isPlainObject, oneLine, shortSha } from './util.mjs';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function repoParts(event, env) {
  const repository = isPlainObject(event.repository) ? event.repository : {};
  const fullName =
    repository.full_name ??
    env.GITHUB_REPOSITORY ??
    [repository.owner?.login ?? env.GITHUB_REPOSITORY_OWNER, repository.name].filter(Boolean).join('/');
  const ownerLogin =
    repository.owner?.login ??
    env.GITHUB_REPOSITORY_OWNER ??
    (fullName ? String(fullName).split('/')[0] : undefined);
  const name = repository.name ?? (fullName ? String(fullName).split('/')[1] : undefined);
  const htmlUrl =
    repository.html_url ??
    (fullName && env.GITHUB_SERVER_URL ? `${env.GITHUB_SERVER_URL}/${fullName}` : undefined);
  return { repository, fullName, ownerLogin, name, htmlUrl };
}

function enrichCommit(commit) {
  if (!isPlainObject(commit)) return commit;
  const message = commit.message ?? '';
  return {
    ...commit,
    short_sha: shortSha(commit.id ?? commit.sha ?? ''),
    first_line: oneLine(message.split(/\r?\n/u)[0] ?? ''),
    one_line: oneLine(message),
    author_name: commit.author?.name ?? commit.author?.login ?? '',
    author_login: commit.author?.username ?? commit.author?.login ?? '',
  };
}

function enrichCommits(event) {
  const raw = Array.isArray(event.commits)
    ? event.commits
    : isPlainObject(event.head_commit)
      ? [event.head_commit]
      : [];
  return raw.map(enrichCommit);
}

function deriveRefName(event, env) {
  if (env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  if (typeof event.ref === 'string' && event.ref) {
    return event.ref.replace(/^refs\/(heads|tags)\//u, '');
  }
  if (isPlainObject(event.pull_request)) {
    return event.pull_request.head?.ref ?? event.pull_request.base?.ref;
  }
  if (isPlainObject(event.workflow_run)) return event.workflow_run.head_branch;
  if (isPlainObject(event.release)) return event.release.tag_name;
  return undefined;
}

function deriveRefType(event, env) {
  if (event.ref_type) return event.ref_type;
  if (isPlainObject(event.pull_request)) return 'branch';
  if (typeof env.GITHUB_REF === 'string') {
    if (env.GITHUB_REF.startsWith('refs/tags/')) return 'tag';
    if (env.GITHUB_REF.startsWith('refs/heads/')) return 'branch';
  }
  return undefined;
}

function deriveSha(event, env) {
  return firstNonEmpty(
    env.GITHUB_SHA,
    event.after,
    event.pull_request?.head?.sha,
    event.workflow_run?.head_sha,
    event.head_commit?.id,
    event.check_suite?.head_sha,
  );
}

function deriveActor(event, env) {
  return firstNonEmpty(
    env.GITHUB_ACTOR,
    event.sender?.login,
    event.pusher?.name,
    event.pull_request?.user?.login,
    event.issue?.user?.login,
    event.release?.author?.login,
  );
}

function deriveDetailUrl({ eventName, event, repository, repoHtmlUrl, compareUrl, commitUrl }) {
  const pr = event.pull_request;
  if (pr?.html_url) return pr.html_url;
  const issue = event.issue;
  if (issue?.html_url) return issue.html_url;
  const comment = event.comment;
  if (comment?.html_url) return comment.html_url;
  const release = event.release;
  if (release?.html_url) return release.html_url;
  const run = event.workflow_run;
  if (run?.html_url) return run.html_url;

  if (eventName === 'push') return compareUrl ?? commitUrl ?? repoHtmlUrl;
  if (eventName === 'star' || eventName === 'fork') {
    if (eventName === 'fork' && event.forkee?.html_url) return event.forkee.html_url;
    return repoHtmlUrl;
  }
  if (eventName === 'create') {
    if (event.ref_type === 'tag' && repoHtmlUrl) return `${repoHtmlUrl}/releases/tag/${event.ref}`;
    if (event.ref_type === 'branch' && repoHtmlUrl) return `${repoHtmlUrl}/tree/${event.ref}`;
    return repoHtmlUrl;
  }
  if (eventName === 'delete') return repoHtmlUrl;
  return repository.html_url ?? repoHtmlUrl ?? undefined;
}

/**
 * Build the safe template context.
 *
 * Deliberately excludes secrets, tokens, the full env object, action inputs,
 * and arbitrary event fields that are not useful for a notification.
 */
export function buildContext({ eventName, event, env = process.env, inputs = {}, now = new Date() }) {
  const payload = isPlainObject(event) ? event : {};
  const { repository, fullName, ownerLogin, name, htmlUrl } = repoParts(payload, env);

  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';
  const runId = firstNonEmpty(env.GITHUB_RUN_ID, payload.workflow_run?.id, payload.run_id);
  const runNumber = firstNonEmpty(env.GITHUB_RUN_NUMBER, payload.workflow_run?.run_number);
  const runAttempt = firstNonEmpty(env.GITHUB_RUN_ATTEMPT, payload.workflow_run?.run_attempt);
  const workflow = firstNonEmpty(env.GITHUB_WORKFLOW, payload.workflow_run?.name, payload.workflow?.name);
  const job = env.GITHUB_JOB;
  const ref = firstNonEmpty(env.GITHUB_REF, payload.ref, payload.pull_request?.head?.ref);
  const refName = deriveRefName(payload, env);
  const refType = deriveRefType(payload, env);
  const sha = deriveSha(payload, env);
  const actor = deriveActor(payload, env);
  const triggeringActor = firstNonEmpty(env.GITHUB_TRIGGERING_ACTOR, actor);

  const commits = enrichCommits(payload);
  const headCommit = isPlainObject(payload.head_commit) ? enrichCommit(payload.head_commit) : commits.at(-1);
  const commitCount = commits.length;
  const commitUrl = sha && fullName ? `${serverUrl}/${fullName}/commit/${sha}` : undefined;
  const before = payload.before;
  const after = payload.after ?? sha;
  const zeroBefore = typeof before === 'string' && /^0+$/u.test(before);
  const compareUrl =
    payload.compare ??
    (fullName && before && after && !zeroBefore ? `${serverUrl}/${fullName}/compare/${before}...${after}` : undefined);
  const runUrl = fullName && runId ? `${serverUrl}/${fullName}/actions/runs/${runId}` : undefined;
  const detailUrl = deriveDetailUrl({
    eventName,
    event: payload,
    repository,
    repoHtmlUrl: htmlUrl,
    compareUrl,
    commitUrl,
  });

  const nowDate = now instanceof Date ? now : new Date(now ?? Date.now());
  const nowIso = Number.isNaN(nowDate.getTime()) ? new Date().toISOString() : nowDate.toISOString();
  const nowUnix = Math.floor(nowDate.getTime() / 1000);

  const github = {
    repository: fullName,
    repository_owner: ownerLogin,
    repository_owner_id: repository.owner?.id,
    actor,
    triggering_actor: triggeringActor,
    event_name: eventName,
    ref,
    ref_name: refName,
    ref_type: refType,
    sha,
    run_id: runId,
    run_number: runNumber,
    run_attempt: runAttempt,
    workflow,
    job,
    server_url: serverUrl,
    api_url: env.GITHUB_API_URL,
    action_path: env.WECOM_ACTION_PATH ?? env.GITHUB_ACTION_PATH,
    workspace: env.GITHUB_WORKSPACE,
    event_path: env.GITHUB_EVENT_PATH,
  };

  const repo = {
    ...repository,
    owner: ownerLogin,
    owner_login: ownerLogin,
    name,
    full_name: fullName,
    html_url: htmlUrl,
    url: repository.url ?? (env.GITHUB_API_URL && fullName ? `${env.GITHUB_API_URL}/repos/${fullName}` : undefined),
    default_branch: repository.default_branch,
    description: repository.description,
    private: repository.private,
    fork: repository.fork,
    stargazers_count: repository.stargazers_count,
    forks_count: repository.forks_count,
    open_issues_count: repository.open_issues_count,
  };

  return {
    event: payload,
    event_name: eventName,
    event_action: payload.action,
    actor,
    triggering_actor: triggeringActor,
    sender: payload.sender,
    repository,
    repo,
    github,
    ref,
    ref_name: refName,
    ref_type: refType,
    branch: typeof refName === 'string' && refType !== 'tag' ? refName : undefined,
    tag: refType === 'tag' ? refName : payload.release?.tag_name,
    sha,
    short_sha: shortSha(sha),
    workflow,
    run_id: runId,
    run_number: runNumber,
    run_attempt: runAttempt,
    run_url: runUrl,
    job,
    commits,
    commit_count: commitCount,
    head_commit: headCommit,
    compare_url: compareUrl,
    commit_url: commitUrl,
    detail_url: detailUrl,
    now: nowIso,
    now_unix: nowUnix,
    vars: isPlainObject(inputs.vars) ? inputs.vars : {},
    pr: payload.pull_request,
    pull_request: payload.pull_request,
    issue: payload.issue,
    comment: payload.comment,
    release: payload.release,
    workflow_run: payload.workflow_run,
    star: eventName === 'star' ? { action: payload.action, count: repository.stargazers_count } : undefined,
    fork: eventName === 'fork' ? payload.forkee : undefined,
    create: eventName === 'create' ? { ref: payload.ref, ref_type: payload.ref_type } : undefined,
    delete: eventName === 'delete' ? { ref: payload.ref, ref_type: payload.ref_type } : undefined,
    pusher: payload.pusher,
    before,
    after,
  };
}
