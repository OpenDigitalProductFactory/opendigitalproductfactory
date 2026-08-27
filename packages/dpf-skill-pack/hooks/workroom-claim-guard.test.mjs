// packages/dpf-skill-pack/hooks/workroom-claim-guard.test.mjs
//
// BI-0B292D84 — AGENTS.md §12 requires a Workroom claim before work on every
// surface. It had no guard, so it was prose: 30 of 79 live worktree branches
// carried no WorkCapsule binding when this was measured on 2026-08-26.
//
// The decision table is pure so the whole thing is testable without a repo, a
// clock or a network. A guard that is wrong one way wedges every session and
// wrong the other way enforces nothing, so both directions are asserted.
//
// Run: node --test packages/dpf-skill-pack/hooks/workroom-claim-guard.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyClaim,
  denyGuidance,
  isClaimExemptBranch,
  parseClaimMarker,
} from "./lib/workroom-claim-lookup.mjs";
import { isWorkCommand, isWorkInvocation } from "./workroom-claim-guard.mjs";

const NOW = Date.parse("2026-08-27T04:00:00.000Z");
const future = new Date(NOW + 30 * 60 * 1000).toISOString();
const past = new Date(NOW - 60 * 1000).toISOString();

const markerFor = (branch, expiresAt, capsuleId = "WC-0FF5B0E9") =>
  JSON.stringify({ capsuleId, branch, leaseExpiresAt: expiresAt, worktreePath: "D:/wt/x" });

// ── what counts as work ──────────────────────────────────────────────────────

test("edit tools count as work", () => {
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.equal(isWorkInvocation(tool, {}), true, tool);
  }
});

test("reading and inspecting are not work", () => {
  for (const tool of ["Read", "Grep", "Glob", "WebFetch"]) {
    assert.equal(isWorkInvocation(tool, {}), false, tool);
  }
});

test("commands that record work are work; inspecting the repo is not", () => {
  for (const cmd of ["git commit -s -m x", "git cherry-pick abc", "git revert abc", "git merge origin/main", "git rebase main"]) {
    assert.equal(isWorkCommand(cmd), true, cmd);
  }
  for (const cmd of ["git status", "git log --oneline", "git diff", "ls -la", "git fetch origin", "git branch -a", ""]) {
    assert.equal(isWorkCommand(cmd), false, cmd);
  }
});

// ── exemptions ───────────────────────────────────────────────────────────────

test("merge-queue and runner branches need no claim", () => {
  for (const b of ["main", "master", "local/main-parked", "local-integration/slot-0/fix-x"]) {
    assert.equal(isClaimExemptBranch(b), true, b);
  }
  for (const b of ["fix/a", "feat/b", "chore/c", "local-integration/slotX/y", ""]) {
    assert.equal(isClaimExemptBranch(b), false, b);
  }
});

// ── the decision table ───────────────────────────────────────────────────────

test("a live claim for this branch allows the edit", () => {
  const v = classifyClaim({ branch: "fix/a", marker: parseClaimMarker(markerFor("fix/a", future)), nowMs: NOW });
  assert.equal(v.kind, "allow");
  assert.equal(v.capsuleId, "WC-0FF5B0E9");
});

test("no claim denies", () => {
  const v = classifyClaim({ branch: "fix/a", marker: null, nowMs: NOW });
  assert.equal(v.kind, "deny");
  assert.equal(v.reason, "no-claim");
});

test("a claim for a DIFFERENT branch does not cover this one", () => {
  // The exact miss being closed: an agent claims for one item, then works a
  // follow-up fix on another branch under the same worktree.
  const v = classifyClaim({ branch: "fix/b", marker: parseClaimMarker(markerFor("fix/a", future)), nowMs: NOW });
  assert.equal(v.kind, "deny");
  assert.equal(v.reason, "claim-branch-mismatch");
  assert.equal(v.claimedBranch, "fix/a");
});

test("an expired lease is not a claim", () => {
  const v = classifyClaim({ branch: "fix/a", marker: parseClaimMarker(markerFor("fix/a", past)), nowMs: NOW });
  assert.equal(v.kind, "deny");
  assert.equal(v.reason, "claim-lease-expired");
});

test("a corrupt marker reads as no claim, never as a pass", () => {
  for (const raw of ["", "   ", "not json", "{}", '{"capsuleId":"WC-1"}', '{"capsuleId":"WC-1","branch":"fix/a"}', '{"capsuleId":"WC-1","branch":"fix/a","leaseExpiresAt":"nonsense"}', "null", "[]"]) {
    assert.equal(parseClaimMarker(raw), null, JSON.stringify(raw));
    assert.equal(classifyClaim({ branch: "fix/a", marker: parseClaimMarker(raw), nowMs: NOW }).kind, "deny");
  }
});

test("detached HEAD has nothing to claim against and is left to the branch guard", () => {
  assert.equal(classifyClaim({ branch: null, marker: null, nowMs: NOW }).kind, "allow");
});

// ── the property that makes this different from prose ────────────────────────

test("an undeterminable claim is fail-open, and is NOT reported as allowed", () => {
  // A gate that is off must never be indistinguishable from a gate that passed
  // — that is the defect this guard exists to remove, so the unavailable case
  // gets its own verdict kind rather than collapsing into `allow`.
  const v = classifyClaim({ branch: "fix/a", marker: null, nowMs: NOW, lookupFailed: true });
  assert.equal(v.kind, "fail-open");
  assert.notEqual(v.kind, "allow");
  assert.equal(v.reason, "claim-lookup-unavailable");
});

test("every refusal names the branch and the call that fixes it", () => {
  for (const marker of [null, parseClaimMarker(markerFor("fix/other", future)), parseClaimMarker(markerFor("fix/a", past))]) {
    const text = denyGuidance(classifyClaim({ branch: "fix/a", marker, nowMs: NOW }));
    assert.match(text, /fix\/a/);
    assert.match(text, /adopt_worktree/);
    assert.match(text, /§12/);
    assert.match(text, /DPF_ALLOW_UNCLAIMED_WORK=1/);
  }
});
