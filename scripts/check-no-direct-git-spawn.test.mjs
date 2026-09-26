// Tests for the direct-git-spawn ratchet (plan 2026-09-08 §10.5 S1).
// Run: node --test scripts/check-no-direct-git-spawn.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { findSpawnLines, findStaleAllowlist, scanRepo } from "./check-no-direct-git-spawn.mjs";

test("flags each way of starting git", () => {
  assert.equal(findSpawnLines('execFileSync("git", ["status"])').length, 1);
  assert.equal(findSpawnLines("spawnSync('git', args, { cwd })").length, 1);
  assert.equal(findSpawnLines("execSync(`git rev-parse HEAD`)").length, 1);
  assert.equal(findSpawnLines('execSync("git status --short")').length, 1);
  assert.equal(findSpawnLines('spawn("git", ["fetch"])').length, 1);
});

test("ignores comments, the shared runner and other binaries", () => {
  assert.equal(findSpawnLines('// execFileSync("git", ["status"])').length, 0);
  assert.equal(findSpawnLines(' * spawnSync("git", args)').length, 0);
  assert.equal(findSpawnLines('gitText(["status"])').length, 0);
  assert.equal(findSpawnLines('execFileSync("gitleaks", ["detect"])').length, 0);
  assert.equal(findSpawnLines('spawnSync("tar", ["-czf"])').length, 0);
});

test("repo: no direct git spawn outside the runner and the backlog; backlog not stale", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
