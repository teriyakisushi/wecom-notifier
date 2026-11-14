import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractReleaseNotes, normalizeVersion } from '../scripts/lib/release-notes.mjs';

// Node 18 没有 import.meta.dirname，这里沿用其它测试的写法。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHANGELOG = `
# Changelog

## [Unreleased]

### Fixed

- 还没发布的东西

## [0.2.0] - 2026-11-14

### Added

- 一个特性

### Fixed

- 一个修复
- [链接](https://github.com/teriyakisushi/wecom-notifier/pull/1)

## [0.1.0] - 2026-01-01

- 老的
`;

describe('extractReleaseNotes', () => {
  it('takes the section between the version heading and the next one', () => {
    const notes = extractReleaseNotes(CHANGELOG, 'v0.2.0');
    assert.match(notes, /^### Added\n\n- 一个特性/);
    assert.match(notes, /一个修复/);
    assert.doesNotMatch(notes, /还没发布的东西/);
    assert.doesNotMatch(notes, /老的/);
    assert.doesNotMatch(notes, /## \[0\.1\.0\]/);
  });

  it('works with the oldest section and without a date', () => {
    assert.equal(extractReleaseNotes(CHANGELOG, '0.1.0'), '- 老的');
  });

  it('accepts headings without brackets', () => {
    assert.equal(extractReleaseNotes('## 1.2.3\n\n- x\n', 'v1.2.3'), '- x');
  });

  it('ignores a heading that only shares the prefix', () => {
    const changelog = '## [0.2.0-rc.1] - 2026-11-01\n\n- rc\n\n## [0.2.0] - 2026-11-14\n\n- final\n';
    assert.equal(extractReleaseNotes(changelog, 'v0.2.0'), '- final');
  });

  it('rejects non-semver tags', () => {
    assert.throws(() => extractReleaseNotes(CHANGELOG, 'v1'), /not a semantic version tag/);
    assert.throws(() => extractReleaseNotes(CHANGELOG, 'main'), /not a semantic version tag/);
  });

  it('fails loudly when the section is missing or empty', () => {
    assert.throws(() => extractReleaseNotes(CHANGELOG, 'v9.9.9'), /no "## \[9\.9\.9\]" section/);
    assert.throws(
      () => extractReleaseNotes('## [1.0.0] - 2026-01-01\n\n## [0.9.0]\n- old\n', 'v1.0.0'),
      /section for 1\.0\.0 is empty/,
    );
  });
});

describe('normalizeVersion', () => {
  it('strips the v prefix and trims', () => {
    assert.equal(normalizeVersion(' v1.2.3 '), '1.2.3');
  });

  it('keeps prerelease and build metadata', () => {
    assert.equal(normalizeVersion('v1.2.3-rc.1'), '1.2.3-rc.1');
    assert.equal(normalizeVersion('v1.2.3+build.5'), '1.2.3+build.5');
  });
});

describe('release-notes CLI', () => {
  const script = path.join(ROOT, 'scripts', 'release-notes.mjs');
  const changelog = path.join(ROOT, 'CHANGELOG.md');

  it('prints the current release section', () => {
    const out = execFileSync(process.execPath, [script, 'v0.2.0', '--changelog', changelog], {
      encoding: 'utf8',
    });
    assert.match(out, /^### Added/m);
    assert.match(out, /`html` input was not declared in `action\.yml`/);
    assert.doesNotMatch(out, /Unreleased/);
  });

  it('exits non-zero for an unknown version', () => {
    assert.throws(
      () =>
        execFileSync(process.execPath, [script, 'v9.9.9', '--changelog', changelog], {
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      /Command failed/,
    );
  });
});
