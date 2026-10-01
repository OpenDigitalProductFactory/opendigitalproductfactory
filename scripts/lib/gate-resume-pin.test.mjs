// BI-D35B85BF — the decisions a RESUMED local-CI gate makes that a fresh one
// does not. Pure, so they run in the policy guards without a gate process; the
// stub-server behaviour of the whole gate lives in gate-worktree-lease.test.mjs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  decideTerminalClaim,
  isResumedGateRun,
  resumeClaimFields,
  verifyPinnedSource,
} from "./gate-resume-pin.mjs";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-resume-pin-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "fix/pinned"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "dpf-test@example.invalid"]);
  writeFileSync(join(dir, "README.md"), "pinned\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "pinned"]);
  return { dir, git, sha: git(["rev-parse", "HEAD"]) };
}

test("a gate is resumed when its resumer pinned a lease or marked the environment", () => {
  assert.equal(isResumedGateRun({ resumeLeaseId: "", env: {} }), false);
  assert.equal(isResumedGateRun({ resumeLeaseId: "NPEL-1", env: {} }), true);
  assert.equal(isResumedGateRun({ resumeLeaseId: "", env: { DPF_DURABLE_RESUME: "1" } }), true);
  // The OFF switch for the resumer is a different variable and means nothing here.
  assert.equal(isResumedGateRun({ resumeLeaseId: "", env: { DPF_DURABLE_RESUMER: "off" } }), false);
});

// AC-DW-03: the pinned candidate is what runs, or nothing runs.
test("the pinned source verifies while HEAD, the branch and the tree are untouched", () => {
  const repo = makeRepo();
  try {
    const verdict = verifyPinnedSource({ worktreePath: repo.dir, branch: "fix/pinned", sha: repo.sha });
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.ok, true);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a moved HEAD and branch are drift, named as such", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "README.md"), "moved\n");
    repo.git(["commit", "-qam", "moved"]);
    const verdict = verifyPinnedSource({ worktreePath: repo.dir, branch: "fix/pinned", sha: repo.sha });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.reasons, ["head-moved", "branch-moved"]);
    assert.notEqual(verdict.head, repo.sha);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a branch moved elsewhere is drift even when this worktree's HEAD is still the pin", () => {
  const repo = makeRepo();
  try {
    repo.git(["checkout", "-q", "--detach"]);
    writeFileSync(join(repo.dir, "README.md"), "elsewhere\n");
    repo.git(["commit", "-qam", "elsewhere"]);
    repo.git(["branch", "-f", "fix/pinned", "HEAD"]);
    repo.git(["checkout", "-q", repo.sha]);
    const verdict = verifyPinnedSource({ worktreePath: repo.dir, branch: "fix/pinned", sha: repo.sha });
    assert.deepEqual(verdict.reasons, ["branch-moved"]);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("an uncommitted change is drift: the tree that would run is not the pinned one", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.dir, "untracked.txt"), "dirt\n");
    const verdict = verifyPinnedSource({ worktreePath: repo.dir, branch: "fix/pinned", sha: repo.sha });
    assert.deepEqual(verdict.reasons, ["worktree-dirty"]);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a pin with no SHA or an unreadable worktree never verifies", () => {
  const missing = join(tmpdir(), "dpf-resume-pin-does-not-exist");
  const verdict = verifyPinnedSource({ worktreePath: missing, branch: "fix/pinned", sha: "a".repeat(40) });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.includes("head-moved"));
  assert.ok(verdict.reasons.includes("status-unreadable"));
  assert.equal(verifyPinnedSource({ worktreePath: missing, branch: "x", sha: "" }).reasons[0], "no-pinned-sha");
});

// AC-DW-01: an explicit cancellation stops automated reclaims.
test("a cancellation of the lease a resumed gate is waiting on stops it", () => {
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "cancelled", resumed: true, heldLeaseId: "", interruptedByQuiescence: false }),
    { action: "stop", reason: "cancelled" },
  );
});

test("a cancellation of the lease this process already held stops it too", () => {
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "cancelled", resumed: false, heldLeaseId: "NPEL-1", interruptedByQuiescence: false }),
    { action: "stop", reason: "cancelled" },
  );
});

// BI-C59AC8AF: a fresh explicit run that meets somebody's prior cancelled row
// is a person asking again, and still gets a fresh attempt.
test("a fresh explicit run that meets a prior cancelled row still gets a fresh attempt", () => {
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "cancelled", resumed: false, heldLeaseId: "", interruptedByQuiescence: false }),
    { action: "replace", reestablishQueueIntent: false },
  );
});

// AC-DW-05: quiescence recovery stays, but only on evidence of quiescence.
test("only a claim quiescence EXPIRED re-establishes queue intent", () => {
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "expired", resumed: false, heldLeaseId: "", interruptedByQuiescence: true }),
    { action: "replace", reestablishQueueIntent: true },
  );
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "released", resumed: false, heldLeaseId: "", interruptedByQuiescence: true }),
    { action: "replace", reestablishQueueIntent: false },
  );
  // An operator cancelling during quiescence is a cancellation, not quiescence.
  assert.deepEqual(
    decideTerminalClaim({ terminalReason: "cancelled", resumed: false, heldLeaseId: "NPEL-1", interruptedByQuiescence: true }),
    { action: "stop", reason: "cancelled" },
  );
});

test("a claim pins the lease this process holds, else the one its resumer pinned", () => {
  assert.deepEqual(resumeClaimFields({ heldLeaseId: "", pinnedLeaseId: "" }), {});
  assert.deepEqual(resumeClaimFields({ heldLeaseId: "", pinnedLeaseId: "NPEL-PIN" }), { resumeLeaseId: "NPEL-PIN" });
  assert.deepEqual(resumeClaimFields({ heldLeaseId: "NPEL-HELD", pinnedLeaseId: "NPEL-PIN" }), { resumeLeaseId: "NPEL-HELD" });
});
