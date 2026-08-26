import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { worktreeContextFromGit } from "../pregate-status.mjs";

import {
  classifySlotRecord,
  exitCodeForVerdict,
  formatStatusReport,
  reconcileSlots,
} from "./pregate-status.mjs";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.parse("2026-08-04T12:00:00.000Z");

test("status reader preserves the central bare common-dir as the canonical root", () => {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-pregate-status-"));
  const worktreePath = join(hostRoot, "candidate");
  const gitCommonDir = join(hostRoot, ".opendigitalproductfactory.git");
  const statePath = join(gitCommonDir, "worktrees", "candidate", "dpf-local-ci-gate.json");

  const context = worktreeContextFromGit({
    worktreePath,
    gitCommonDirRaw: gitCommonDir,
    statePathRaw: statePath,
    headBranch: "fix/example",
    headSha: "abc123",
  });

  assert.equal(context.gitCommonDir, gitCommonDir);
  assert.equal(context.rootClone, gitCommonDir);
  assert.equal(context.candidateGitDir, join(gitCommonDir, "worktrees", "candidate"));
});

test("status reader still resolves a normal clone root from its .git common-dir", () => {
  const hostRoot = mkdtempSync(join(tmpdir(), "dpf-pregate-status-normal-"));
  const worktreePath = join(hostRoot, "clone");
  const gitCommonDir = join(worktreePath, ".git");

  const context = worktreeContextFromGit({
    worktreePath,
    gitCommonDirRaw: gitCommonDir,
    statePathRaw: join(gitCommonDir, "dpf-local-ci-gate.json"),
    headBranch: "fix/example",
    headSha: "abc123",
  });

  assert.equal(context.rootClone, worktreePath);
});

function passingState(overrides = {}) {
  return {
    branch: "claude/topic",
    sha: HEAD,
    gatePassed: true,
    status: "passed",
    evidenceRecordId: "EXT-1",
    evidencePending: false,
    expiresAt: "2026-08-04T13:00:00.000Z",
    recordedAt: "2026-08-04T11:40:00.000Z",
    ...overrides,
  };
}

test("PASS requires a passing record bound to THIS head", () => {
  const r = classifySlotRecord({
    state: passingState(),
    metadata: { candidateSha: HEAD },
    headSha: HEAD,
    headBranch: "claude/topic",
    now: NOW,
  });
  assert.equal(r.verdict, "PASS");
  assert.equal(exitCodeForVerdict(r.verdict), 0);
});

test("NO-RECORD when pregate never ran here", () => {
  const r = classifySlotRecord({ state: null, metadata: null, headSha: HEAD, now: NOW });
  assert.equal(r.verdict, "NO-RECORD");
  assert.equal(exitCodeForVerdict(r.verdict), 1);
});

test("STALE when HEAD has moved past the gated SHA", () => {
  const r = classifySlotRecord({
    state: passingState({ sha: OLD }),
    metadata: { candidateSha: OLD },
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "STALE");
  assert.equal(r.staleness, "head-moved");
  assert.match(r.reason, /bbbbbbbbbbbb/);
  assert.match(r.reason, /aaaaaaaaaaaa/);
  assert.equal(exitCodeForVerdict(r.verdict), 1);
});

test("STALE when the branch moved under an otherwise-matching SHA", () => {
  const r = classifySlotRecord({
    state: passingState({ branch: "claude/other" }),
    metadata: { candidateSha: HEAD },
    headSha: HEAD,
    headBranch: "claude/topic",
    now: NOW,
  });
  assert.equal(r.verdict, "STALE");
  assert.equal(r.staleness, "branch-moved");
});

test("STALE when the record has expired", () => {
  const r = classifySlotRecord({
    state: passingState({ expiresAt: "2026-08-04T11:00:00.000Z" }),
    metadata: { candidateSha: HEAD },
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "STALE");
  assert.equal(r.staleness, "expired");
});

test("STALE when the metadata record disagrees with the gate state", () => {
  // The two records are written by different processes; a disagreement means one
  // of them is not describing this run, which must never read as a PASS.
  const r = classifySlotRecord({
    state: passingState(),
    metadata: { candidateSha: OLD },
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "STALE");
  assert.equal(r.staleness, "metadata-mismatch");
});

test("FAIL when the record exists for this SHA but did not pass", () => {
  const r = classifySlotRecord({
    state: passingState({ gatePassed: false, status: "failed" }),
    metadata: null,
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "FAIL");
  assert.equal(exitCodeForVerdict(r.verdict), 1);
});

test("a run that gave up while queued reads FAIL, not PASS", () => {
  // BI-2C7F51BA Defect 3: that path exits 0 having gated nothing. The record is
  // what makes the silent exit-0 detectable.
  const r = classifySlotRecord({
    state: passingState({ gatePassed: false, status: "blocked_quiescence", evidenceRecordId: "" }),
    metadata: null,
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /blocked_quiescence/);
});

test("PENDING when the gate passed but evidence publication is unfinished", () => {
  const r = classifySlotRecord({
    state: passingState({ evidencePending: true, evidencePendingReason: "portal_quiescing" }),
    metadata: { candidateSha: HEAD },
    headSha: HEAD,
    now: NOW,
  });
  assert.equal(r.verdict, "PENDING");
  assert.match(r.reason, /finalize-evidence/);
  assert.equal(exitCodeForVerdict(r.verdict), 1, "pending evidence is not a green light to push");
});

test("reconcile takes the best slot so a sibling's stale record cannot fake a failure", () => {
  const best = reconcileSlots([
    { slotKey: "slot-0", verdict: "STALE", reason: "old" },
    { slotKey: "slot-1", verdict: "PASS", reason: "gate passed for this HEAD" },
  ]);
  assert.equal(best.verdict, "PASS");
  assert.equal(best.slot, "slot-1");
});

test("reconcile still reports the worst available when nothing passed", () => {
  const best = reconcileSlots([
    { slotKey: "slot-0", verdict: "FAIL", reason: "failed" },
    { slotKey: "slot-1", verdict: "STALE", reason: "old" },
  ]);
  assert.equal(best.verdict, "STALE", "STALE outranks FAIL — it is the more actionable of the two");
});

test("reconcile of nothing is NO-RECORD, never a pass", () => {
  assert.equal(reconcileSlots([]).verdict, "NO-RECORD");
});

test("the report is short enough that nobody pipes it, and names the next step", () => {
  const lines = formatStatusReport(
    { verdict: "STALE", reason: "head moved", boundSha: OLD, boundBranch: "claude/topic", recordedAt: "2026-08-04T11:00:00.000Z", slot: "slot-0", logFile: "D:/x.log" },
    { headBranch: "claude/topic", headSha: HEAD, now: NOW },
  );
  assert.ok(lines.length <= 10, `got ${lines.length} lines`);
  assert.equal(lines[0], "local-CI gate: STALE");
  assert.ok(lines.some((l) => l.includes("pnpm run pregate")), "a non-PASS must name the next step");
  assert.ok(lines.some((l) => l.includes("1h 0m ago")), "staleness must be human-readable");
});

test("a PASS report does not tell you to re-run", () => {
  const lines = formatStatusReport(
    { verdict: "PASS", reason: "gate passed for this HEAD", boundSha: HEAD, boundBranch: "claude/topic" },
    { headBranch: "claude/topic", headSha: HEAD, now: NOW },
  );
  assert.ok(!lines.some((l) => l.includes("next")), "a PASS has no next step");
});

// BI-465B3D60 — a failing record must say why, or say that it cannot.
const failingRecord = (over = {}) => ({
  sha: "abc123", branch: "topic", status: "failed", gatePassed: false, ...over,
});
const atHead = { headSha: "abc123", headBranch: "topic" };

test("failing record names the recorded reason when there is one", () => {
  const out = classifySlotRecord({
    state: failingRecord({ failureReason: "web typecheck exited 2" }),
    metadata: null, ...atHead,
  });
  assert.equal(out.verdict, "FAIL");
  assert.match(out.reason, /web typecheck exited 2/);
});

test("failing record says outright that no reason was recorded", () => {
  // Rather than implying the diff is bad when the record simply does not say.
  const out = classifySlotRecord({ state: failingRecord(), metadata: null, ...atHead });
  assert.equal(out.verdict, "FAIL");
  assert.match(out.reason, /NO recorded reason/);
});

test("a started-then-released run with no failing command is a retry, not a verdict", () => {
  // The observed shape: the run held the slot, ended early, recorded nothing.
  // local-integration-ci runs at effectiveCapacity 1 and several sessions on
  // this host gate at once.
  const out = classifySlotRecord({
    state: failingRecord({
      leaseEvents: [
        { type: "terminal-claim-replaced" },
        { type: "queued", queuePosition: 1 },
        { type: "started" },
        { type: "released" },
      ],
    }),
    metadata: null, ...atHead,
  });
  assert.match(out.reason, /contended slot is a retry/);
  assert.match(out.reason, /not a verdict on your diff/);
});

test("flags a metadata file that describes a different run", () => {
  // The trap this closes: failing runs never rewrote the metadata, so it kept
  // reporting the PREVIOUS run's success. Reading it after a failure yields a
  // confident, wrong "it passed" — only the file mtime gave it away.
  const out = classifySlotRecord({
    state: failingRecord(),
    metadata: { candidateSha: "oldersha", execution: { status: "passed", exitCode: 0 } },
    ...atHead,
  });
  assert.equal(out.staleness, "metadata-describes-another-run");
});

test("does not flag the metadata when it describes this run", () => {
  const out = classifySlotRecord({
    state: failingRecord(),
    metadata: { candidateSha: "abc123", execution: { status: "failed" } },
    ...atHead,
  });
  assert.equal(out.staleness, "");
});

// BI-465B3D60, second recurrence. Four gate runs on ONE unchanged commit
// (efeb0a5a6845 live): three recorded failed, one passed. Because every run had
// the same candidateSha, the SHA comparison could not tell them apart, and the
// failing verdicts quoted a failedCommand from a metadata file 53 minutes stale.
// The lease is the per-run identity that separates them.
const LEASE_THIS_RUN = "NPEL-D4D8BCC247";
const LEASE_PRIOR_RUN = "NPEL-098CE6A455";

test("a re-run on the SAME sha does not inherit the previous run's failedCommand", () => {
  const out = classifySlotRecord({
    state: {
      sha: HEAD, branch: "feat/x", status: "failed", gatePassed: false,
      leaseId: LEASE_THIS_RUN,
      leaseEvents: [{ type: "started" }],
    },
    metadata: {
      candidateSha: HEAD, // identical — this is the case the SHA check cannot see
      runLeaseId: LEASE_PRIOR_RUN,
      execution: { failedCommand: "node scripts/sandbox-freshness-preflight.mjs --converge" },
    },
    headSha: HEAD,
    headBranch: "feat/x",
    now: NOW,
  });

  assert.equal(out.verdict, "FAIL");
  assert.equal(out.staleness, "metadata-describes-another-run");
  assert.ok(
    !out.reason.includes("sandbox-freshness-preflight"),
    `must not quote the previous run's command; got: ${out.reason}`,
  );
  assert.match(out.reason, /previous run/);
  assert.match(out.reason, /not.*verdict on the diff/);
});

test("a failedCommand from THIS run is still reported", () => {
  const out = classifySlotRecord({
    state: {
      sha: HEAD, branch: "feat/x", status: "failed", gatePassed: false,
      leaseId: LEASE_THIS_RUN,
    },
    metadata: {
      candidateSha: HEAD,
      runLeaseId: LEASE_THIS_RUN,
      execution: { failedCommand: "pnpm --filter web build" },
    },
    headSha: HEAD,
    headBranch: "feat/x",
    now: NOW,
  });

  assert.equal(out.verdict, "FAIL");
  assert.equal(out.staleness, "");
  assert.match(out.reason, /pnpm --filter web build/);
});

test("an unstamped metadata record falls back to the sha check rather than crying mismatch", () => {
  // Metadata written before runLeaseId existed, or by an ungoverned run. It has
  // no lease to compare, so a lease-only rule would report every such record as
  // another run's and suppress a cause that is in fact this run's.
  const out = classifySlotRecord({
    state: {
      sha: HEAD, branch: "feat/x", status: "failed", gatePassed: false,
      leaseId: LEASE_THIS_RUN,
    },
    metadata: { candidateSha: HEAD, execution: { failedCommand: "pnpm --filter web build" } },
    headSha: HEAD,
    headBranch: "feat/x",
    now: NOW,
  });

  assert.equal(out.staleness, "");
  assert.match(out.reason, /pnpm --filter web build/);
});

test("the state's own failureReason outranks metadata either way", () => {
  const out = classifySlotRecord({
    state: {
      sha: HEAD, branch: "feat/x", status: "failed", gatePassed: false,
      leaseId: LEASE_THIS_RUN, failureReason: "typecheck failed",
    },
    metadata: { candidateSha: HEAD, runLeaseId: LEASE_PRIOR_RUN, execution: { failedCommand: "stale" } },
    headSha: HEAD,
    headBranch: "feat/x",
    now: NOW,
  });

  assert.match(out.reason, /typecheck failed/);
});
