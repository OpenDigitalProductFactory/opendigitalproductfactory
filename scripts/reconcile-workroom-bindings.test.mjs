// scripts/reconcile-workroom-bindings.test.mjs
//
// BI-0B292D84 layer 4 — bind-at-birth governs the future; reconciliation is
// what closes the gap that already exists. On 2026-08-27, 31 of 91 live
// branches had no Workroom binding, a number unchanged since the rule was
// written, because nothing ever went back for the branches created before it.
//
// Run: node --test scripts/reconcile-workroom-bindings.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseWorktrees, partitionForReconciliation, summarize } from "./reconcile-workroom-bindings.mjs";

const PORCELAIN = [
  "worktree D:/DPF-source-root",
  "HEAD 2468ca8ba6",
  "branch refs/heads/main",
  "",
  "worktree D:/DPF-worktrees/feature-a",
  "HEAD 9f94d810cb",
  "branch refs/heads/feat/a",
  "",
  "worktree D:/DPF-scratch/detached",
  "HEAD d6120707e2",
  "detached",
  "",
  "worktree D:/DPF-worktrees/ci",
  "HEAD 46d295f40e",
  "branch refs/heads/local-integration/slot-0/fix-x",
  "",
].join("\n");

test("parses worktrees and strips refs/heads from branch names", () => {
  const w = parseWorktrees(PORCELAIN);
  assert.equal(w.length, 4);
  assert.deepEqual(w[1], { path: "D:/DPF-worktrees/feature-a", branch: "feat/a" });
});

test("a detached worktree carries no branch", () => {
  const w = parseWorktrees(PORCELAIN);
  assert.equal(w[2].branch, null);
});

test("tolerates empty and trailing-record input", () => {
  assert.deepEqual(parseWorktrees(""), []);
  assert.deepEqual(parseWorktrees(null), []);
  const one = parseWorktrees("worktree /a\nHEAD x\nbranch refs/heads/fix/z");
  assert.deepEqual(one, [{ path: "/a", branch: "fix/z" }]);
});

test("main, CI slots and detached heads are exempt; real feature branches are not", () => {
  const { claimable, exempt } = partitionForReconciliation(parseWorktrees(PORCELAIN));
  assert.deepEqual(claimable.map((c) => c.branch), ["feat/a"]);
  assert.equal(exempt.length, 3);
  // Every exemption states WHY, so a reader can challenge it.
  for (const e of exempt) assert.ok(e.why && e.why.length > 0, `${e.path} must say why it is exempt`);
});

test("the dry run says ENSURED, not unbound — it cannot tell bound from unbound", () => {
  // adopt_worktree is bind-or-reuse. Reporting "31 unbound" without asking MCP
  // per branch would be exactly the kind of confident-but-unverified number
  // this work exists to eliminate.
  const { claimable, exempt } = partitionForReconciliation(parseWorktrees(PORCELAIN));
  const text = summarize({ claimable, exempt, bound: 0, failed: 0, applied: false });
  assert.match(text, /ENSURED/);
  assert.doesNotMatch(text, /unbound/);
  assert.match(text, /--apply/);
});

test("the applied summary reports real coverage and names failures", () => {
  const { claimable, exempt } = partitionForReconciliation(parseWorktrees(PORCELAIN));
  const ok = summarize({ claimable, exempt, bound: 1, failed: 0, applied: true });
  assert.match(ok, /claim ensured for 1\/1 \(100%\)/);
  assert.doesNotMatch(ok, /could not be bound/);

  const partial = summarize({ claimable, exempt, bound: 0, failed: 1, applied: true });
  assert.match(partial, /0\/1 \(0%\)/);
  assert.match(partial, /1 could not be bound/);
});
