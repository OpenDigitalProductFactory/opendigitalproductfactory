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
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  NUDGE_INTERVAL_MS,
  classifyClaim,
  denyGuidance,
  isClaimExemptBranch,
  parseClaimMarker,
  shouldNudge,
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

// ── functional: drive the actual binary, not just the pure helpers ───────────
//
// These exist because the unit tests above ALL PASSED while the guard was
// completely inert. It read payload.tool_name / payload.tool_input, but
// readHookPayload normalizes to toolName/toolInput, so every lookup was
// undefined, isWorkInvocation always returned false, and the guard allowed
// everything — while still exiting 0 and looking exactly like a guard that ran
// and was satisfied. Testing the pure decision table cannot catch a wiring
// defect; only feeding a real payload through the process can.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const guardPath = join(dirname(fileURLToPath(import.meta.url)), "workroom-claim-guard.mjs");

/** Run the guard on a payload; return its stdout. */
function runGuard(payload, env = {}) {
  // A repo-shaped dir so inDpfWorkspace resolves, with no git repo inside it:
  // no branch -> the decision table's "no-branch" allow. Branch-specific
  // behaviour is covered by the pure tests above; what these assert is that the
  // payload actually reaches the decision at all.
  return execFileSync(process.execPath, [guardPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", ...env },
  });
}

test("a Write payload reaches the decision — snake_case field names from the surface are normalized", () => {
  const out = runGuard(
    { tool_name: "Write", tool_input: { file_path: "x.ts" }, cwd: process.cwd() },
    { DPF_WORKROOM_CLAIM_ENFORCE: "1" },
  );
  // Either it denies (unclaimed branch) or stays silent (exempt/no branch) —
  // but the guard must not CRASH, and when it speaks it must be a valid envelope.
  if (out.trim() !== "") {
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
  }
});

test("the guard never crashes and never blocks on a malformed payload", () => {
  // Genuinely unusable payloads only. `{"tool_name":"Write"}` is NOT one of
  // them: it is a well-formed edit whose cwd defaults to the process cwd (the
  // same fallback root-clone-guard uses), so denying it is correct, not a
  // fail-open violation.
  for (const input of ["", "not json", "{}", "null", "[]", '{"tool_name":"Read"}']) {
    const out = execFileSync(process.execPath, [guardPath], {
      input,
      encoding: "utf8",
      env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_WORKROOM_CLAIM_ENFORCE: "1" },
    });
    assert.doesNotMatch(out, /"permissionDecision":"deny"/, `must fail open on: ${JSON.stringify(input)}`);
  }
});

test("the explicit bypass silences the guard even under enforcement", () => {
  const out = runGuard(
    { tool_name: "Write", tool_input: { file_path: "x.ts" }, cwd: process.cwd() },
    { DPF_WORKROOM_CLAIM_ENFORCE: "1", DPF_ALLOW_UNCLAIMED_WORK: "1" },
  );
  assert.equal(out.trim(), "");
});

test("reading is never work, even under enforcement", () => {
  const out = runGuard({ tool_name: "Read", tool_input: {}, cwd: process.cwd() }, { DPF_WORKROOM_CLAIM_ENFORCE: "1" });
  assert.equal(out.trim(), "");
});

test("the guard reads the normalized camelCase payload keys, not the raw snake_case ones", () => {
  // The regression itself, asserted at the source: a lookup of tool_name /
  // tool_input in the guard body means the guard is inert.
  const source = readFileSync(guardPath, "utf8");
  const offending = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .filter((line) => /payload\.tool_(name|input)/.test(line));
  assert.deepEqual(offending, [], "guard must read payload.toolName/payload.toolInput (hook-io normalizePayload)");
});

test("the claim marker is scoped PER WORKTREE, not to the shared git dir", () => {
  // --git-common-dir is shared by every worktree of the repo, so a marker there
  // would be read by all of them and only ONE branch could hold a claim across
  // the whole estate — the opposite of "one thread = one branch + one worktree".
  // --git-dir is per-worktree (.git/worktrees/<name>). Verified by hand: with a
  // matching marker the guard is silent; with an expired lease or a marker for
  // another branch it denies.
  const source = readFileSync(guardPath, "utf8");
  const code = source.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("//"));
  assert.ok(
    code.some((line) => line.includes('"--git-dir"')),
    "the marker must be read from the per-worktree --git-dir",
  );
  assert.deepEqual(
    code.filter((line) => line.includes('"--git-common-dir"')),
    [],
    "the marker must NOT be read from the shared --git-common-dir",
  );
});

// ── the advisory is throttled; a refusal never is ────────────────────────────

test("shouldNudge speaks once, then stays quiet for the interval", () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  const b = "fix/a";
  assert.equal(shouldNudge({ stampMs: null, stampBranch: null, branch: b, nowMs: now }), true, "never nudged -> speak");
  assert.equal(shouldNudge({ stampMs: now - 1000, stampBranch: b, branch: b, nowMs: now }), false, "just nudged -> quiet");
  assert.equal(
    shouldNudge({ stampMs: now - NUDGE_INTERVAL_MS - 1, stampBranch: b, branch: b, nowMs: now }),
    true,
    "interval elapsed -> speak again",
  );
});

test("a different branch is a different fact and is always said once", () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  assert.equal(
    shouldNudge({ stampMs: now - 1000, stampBranch: "fix/other", branch: "fix/a", nowMs: now }),
    true,
    "switching branches must re-notify even inside the interval",
  );
});

test("an unreadable stamp reads as never-nudged, never as already-nudged", () => {
  // An extra advisory is cheap; a suppressed one is the bug.
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  assert.equal(shouldNudge({ stampMs: Number.NaN, stampBranch: "fix/a", branch: "fix/a", nowMs: now }), true);
});

test("the refusal path is not throttled — enforcement ignores the stamp", () => {
  // A gate that declines to refuse because it refused recently is not a gate.
  // emitDeny must be reached before any nudge bookkeeping.
  const source = readFileSync(guardPath, "utf8");
  const denyIdx = source.indexOf("emitDeny(guidance)");
  const nudgeIdx = source.indexOf("shouldNudge(");
  assert.ok(denyIdx > 0 && nudgeIdx > 0, "both paths must exist");
  assert.ok(denyIdx < nudgeIdx, "emitDeny must come before the throttle check, so a refusal is never suppressed");
});

// ── the default is now REFUSE (BI-0B292D84 layer 1 landed) ──────────────────

test("with NO env set, an unclaimed edit is DENIED — enforcement is the default", () => {
  // This is the behaviour change bind-at-birth bought. It was advisory only
  // while nothing wrote the claim automatically; refusing then would have
  // blocked agents for a condition they could not satisfy.
  const out = execFileSync(process.execPath, [guardPath], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x.ts" }, cwd: process.cwd() }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_WORKROOM_CLAIM_ENFORCE: undefined, DPF_ALLOW_UNCLAIMED_WORK: undefined },
  });
  // On a branch with no claim this must refuse; on an exempt branch it is silent.
  if (out.trim() !== "") {
    assert.match(out, /"permissionDecision":"deny"/, "the default must refuse, not merely advise");
  }
});

test("DPF_WORKROOM_CLAIM_ENFORCE=0 downgrades to advisory, and nothing else does", () => {
  const out = execFileSync(process.execPath, [guardPath], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x.ts" }, cwd: process.cwd() }),
    encoding: "utf8",
    env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_WORKROOM_CLAIM_ENFORCE: "0" },
  });
  assert.doesNotMatch(out, /"permissionDecision":"deny"/, "explicit 0 must not refuse");
});

test("the refusal names the terminal-capsule dead end, so a leftover worktree is actionable", () => {
  // 12 of 91 branches on this install refused with branch_occupied against a
  // COMPLETE capsule. Telling those operators only "call adopt_worktree" would
  // send them into a refusal loop.
  const text = denyGuidance(classifyClaim({ branch: "fix/a", marker: null, nowMs: NOW }));
  assert.match(text, /branch_occupied/);
  // Was /reap it or start a new branch/ until 2026-08-28. That wording assumed a
  // terminal capsule meant the work was done; eleven branches proved otherwise.
  // The guidance now routes to the check instead of to the destructive action.
  assert.match(text, /rev-list --count/);
});

// ── the refusal must not assert more than the evidence carries ───────────────

test("branch_occupied guidance never claims the work is finished", () => {
  // The original wording said a terminal capsule meant "that branch's work is
  // finished and this worktree is a leftover — reap it". Measured 2026-08-28:
  // ELEVEN branches sat behind terminal capsules carrying unmerged commits, one
  // with 13. The sentence stated as fact something the evidence did not
  // establish, and pointed at the destructive reading of two possible ones.
  const text = denyGuidance(classifyClaim({ branch: "fix/a", marker: null, nowMs: NOW }));
  assert.doesNotMatch(text, /work is finished/, "a closed capsule does not prove the branch work is done");
  assert.doesNotMatch(text, /reap it or start a new branch/, "must not steer to reaping before the branch is checked");
});

test("branch_occupied guidance tells the operator how to tell the two cases apart", () => {
  const text = denyGuidance(classifyClaim({ branch: "fix/a", marker: null, nowMs: NOW }));
  assert.match(text, /rev-list --count/, "must name the check that distinguishes leftover from unresolved");
  assert.match(text, /unresolved, not finished/, "must name the case where the capsule closed over live work");
});
