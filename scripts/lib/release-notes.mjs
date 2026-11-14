/**
 * 从 CHANGELOG.md 里抽出指定版本的段落，供 release workflow 作为 Release 正文。
 *
 * 这里只做纯字符串处理，方便单测；读写文件和退出码在 scripts/release-notes.mjs。
 */

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** `v0.2.0` -> `0.2.0`；不是语义化版本直接报错，避免 release 用错段落。 */
export function normalizeVersion(tag) {
  const version = String(tag ?? '').trim().replace(/^v/i, '');
  if (!SEMVER.test(version)) {
    throw new Error(`"${tag}" is not a semantic version tag (expected vX.Y.Z)`);
  }
  return version;
}

/**
 * 取 `## [0.2.0] - 2026-11-14` 到下一个 `## ` 之间的内容。
 * 兼容 `## [0.2.0]` 和 `## 0.2.0` 两种写法；空段落视为错误。
 */
export function extractReleaseNotes(changelog, tag) {
  const version = normalizeVersion(tag);
  const lines = String(changelog).split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\s|$)`);

  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## [${version}]" section`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return body;
}
