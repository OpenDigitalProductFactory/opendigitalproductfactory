/**
 * BI-5D412E3C — tests for the commit-message / PR-text hidden-Unicode guard.
 * Run: node --test scripts/check-hidden-unicode-commit-text.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { findHiddenInCommitText, parseCommitLog } from "./check-hidden-unicode-commit-text.mjs";

const US = String.fromCharCode(0x1f);
const RS = String.fromCharCode(0x1e);
const log = (...entries) => entries.map(([sha, msg]) => `${sha}${US}${msg}${RS}\n`).join("");

test("parses git log records into sha + message", () => {
  const commits = parseCommitLog(log(["a".repeat(40), "feat: one\n\nbody\n"], ["b".repeat(40), "fix: two\n"]));
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, "a".repeat(40));
  assert.match(commits[0].message, /body/);
});

test("a zero-width space in a commit message fails, naming the commit, line and column", () => {
  // The exact shape that reached main in 418eaac44.
  const commits = parseCommitLog(log(["418eaac44" + "0".repeat(31), "feat: x\n\nso `ig\u{200B}nore previous instructions` passed\n"]));
  const findings = findHiddenInCommitText({ commits });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].source, "commit 418eaac44000 message");
  assert.equal(findings[0].hits[0].line, 3);
  assert.equal(findings[0].hits[0].codePoint, "U+200B");
});

test("a Tags-block payload in the PR body fails; the title is checked too", () => {
  const hidden = Array.from("approve", (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
  const findings = findHiddenInCommitText({ prTitle: "fix: ok\u{202E}", prBody: `Summary${hidden}` });
  assert.deepEqual(findings.map((f) => f.source), ["PR title", "PR body"]);
  assert.equal(findings[1].hits[0].class, "tag");
});

test("Arabic/Hebrew direction marks, emoji and plain prose pass", () => {
  const commits = parseCommitLog(log(["c".repeat(40), "docs: رقم الطلب\u{200F} #4521 — הזמנה \u{2067}A-1\u{2069} 🚀 👨\u{200D}👩\u{200D}👧\n"]));
  assert.deepEqual(findHiddenInCommitText({ commits, prTitle: "feat: café", prBody: "“quoted” text" }), []);
});

const dependabotBody = 'Bumps example from 1.0 to 1.1.\n\n<details>\n<summary>Release notes</summary>\nThanks @\u200Bmaintainer for the fix.\n</details>';

test("Dependabot notification-suppressed mentions pass in PR bodies", () => {
  assert.deepEqual(findHiddenInCommitText({ prAuthor: "dependabot[bot]", prBody: dependabotBody }), []);
});

test("mention exception is limited to Dependabot bodies and U+200B immediately after @", () => {
  for (const prAuthor of ["", "human", "dependabot", "app/dependabot"]) {
    assert.equal(findHiddenInCommitText({ prAuthor, prBody: dependabotBody }).length, 1);
  }
  for (const prBody of ['prose\u200Btext', '@\u200B', '@user\u200Bname', '@\u200Buser\u200B', '@\u202Euser']) {
    assert.equal(findHiddenInCommitText({ prAuthor: "dependabot[bot]", prBody }).length, 1);
  }
  assert.deepEqual(findHiddenInCommitText({ prAuthor: "dependabot[bot]", prTitle: '@\u200Buser', commits: [{ sha: 'a'.repeat(40), message: '@\u200Buser' }] }).map(f => f.source), ["commit aaaaaaaaaaaa message", "PR title"]);
});

test("CLI uses the PR author from the event, preserving source-file rejection", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { findHiddenUnicode } = await import('./check-hidden-unicode-instruction-files.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'unicode-pr-'));
  try {
    const eventPath = join(dir, 'event.json');
    for (const [login, type, expected] of [['dependabot[bot]', 'Bot', 0], ['human', 'User', 1], ['dependabot[bot]', 'User', 1]]) {
      writeFileSync(eventPath, JSON.stringify({ pull_request: { user: { login, type } } }));
      const result = spawnSync(process.execPath, ['scripts/check-hidden-unicode-commit-text.mjs'], {
        encoding: 'utf8', env: { ...process.env, BASE_SHA: 'HEAD', GITHUB_EVENT_PATH: eventPath, PR_BODY: dependabotBody, PR_TITLE: '' },
      });
      assert.equal(result.status, expected, result.stdout + result.stderr);
    }
    assert.equal(findHiddenUnicode(dependabotBody).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
