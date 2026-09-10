import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalCiPassEvidenceValidity,
  isInconclusiveLocalCiGateStatus,
  isRecoverableInterruptedGateState,
  projectReusedPassMetadata,
  readLocalCiGateState,
  supersedeLosingSlotRecords,
  writeLocalCiGateState,
} from "./local-ci-gate-state.mjs";

test("completed PASS evidence receives bounded validity independent of its lease", () => {
  const issuedAt = "2026-08-09T10:00:00.000Z";
  const validity = createLocalCiPassEvidenceValidity({ issuedAt });

  assert.deepEqual(validity, {
    schemaVersion: 1,
    issuedAt,
    expiresAt: "2026-08-10T10:00:00.000Z",
  });
});

test("local-CI gate state helper writes and reads the shared evidence shape", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-state-")), "gate.json");

  writeLocalCiGateState(stateFile, {
    branch: "fix/local-ci-descendant-fence",
    sha: "c".repeat(40),
    gatePassed: false,
    leaseId: "NPEL-STATE",
    evidenceId: "",
    status: "running",
    expiresAt: "2026-07-30T06:00:00.000Z",
    leaseExpiresAt: "2026-07-30T06:00:00.000Z",
    resilience: null,
    leaseEvents: [{ type: "admitted", at: "2026-07-30T05:00:00.000Z" }],
    recovery: { reason: "test" },
    queueObserver: {
      path: "/tmp/dpf-local-ci-queue-observers/observer.json",
      token: "observer-token",
      pid: 12345,
      ownerSessionId: "codex-thread",
    },
  });

  const raw = JSON.parse(readFileSync(stateFile, "utf8"));
  const state = readLocalCiGateState(stateFile);
  assert.equal(raw.status, "running");
  assert.deepEqual(state, raw);
  assert.equal(state.recovery.reason, "test");
  assert.equal(state.queueObserver.token, "observer-token");
  assert.equal(state.leaseExpiresAt, "2026-07-30T06:00:00.000Z");
});

test("a failed record persists the reason and structured summary (BI-DBED32FE, BI-465B3D60)", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-reason-")), "gate.json");
  writeLocalCiGateState(stateFile, {
    branch: "fix/x",
    sha: "a".repeat(40),
    gatePassed: false,
    leaseId: "NPEL-1",
    evidenceId: "",
    status: "failed",
    expiresAt: "2026-08-30T06:00:00.000Z",
    resilience: null,
    leaseEvents: [],
    failureReason: "no stage failed; child exited 1 after local-ci-vitest",
    failureSummary: { schema: "dpf-local-ci-failure-summary/v1", failedTests: [], failedChecks: [] },
    childExitCode: 1,
  });
  const state = readLocalCiGateState(stateFile);
  assert.equal(state.failureReason, "no stage failed; child exited 1 after local-ci-vitest");
  assert.equal(state.childExitCode, 1);
  assert.equal(state.failureSummary.schema, "dpf-local-ci-failure-summary/v1");
});

test("canonical PASS reuse projects current HEAD onto metadata (BI-C6B2D404)", () => {
  const projected = projectReusedPassMetadata(
    { candidateSha: "oldsha", candidateRef: "feat/old", execution: { status: "passed", failedCommand: "stale" } },
    { sha: "newsha", branch: "feat/new", evidenceId: "EXT-9", leaseId: "NPEL-9" },
  );
  assert.equal(projected.candidateSha, "newsha");
  assert.equal(projected.candidateRef, "feat/new");
  assert.equal(projected.reusedEvidenceId, "EXT-9");
  assert.equal(projected.runLeaseId, "NPEL-9");
  assert.equal(projected.execution.status, "passed");
  assert.equal(projected.execution.failedCommand, null);
});

test("only matching queued/admitted/running gate states are recoverable", () => {
  const base = {
    branch: "fix/local-ci-descendant-fence",
    sha: "d".repeat(40),
    leaseId: "NPEL-STATE",
    evidencePending: false,
  };

  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "queued" },
    { branch: base.branch, sha: base.sha },
  ), true);
  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "running" },
    { branch: base.branch, sha: base.sha },
  ), true);
  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "admitted" },
    { branch: base.branch, sha: base.sha },
  ), true);
  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "failed" },
    { branch: base.branch, sha: base.sha },
  ), false);
  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "running", evidencePending: true },
    { branch: base.branch, sha: base.sha },
  ), false);
  assert.equal(isRecoverableInterruptedGateState(
    { ...base, status: "running" },
    { branch: "other", sha: base.sha },
  ), false);
});

test("queued admission diagnostics survive a later terminal state write", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-state-")), "gate.json");
  const shared = {
    branch: "fix/queued-intent-reservation",
    sha: "e".repeat(40),
    gatePassed: false,
    leaseId: "NPEL-QUEUED",
    evidenceId: "",
    expiresAt: "2026-08-09T07:00:00.000Z",
    resilience: null,
    leaseEvents: [],
  };
  const admission = {
    queuePosition: 1,
    waitAgeMs: 7_200_000,
    poolPolicy: {
      hostSafeCapacity: 0,
      effectiveCapacity: 0,
      rollbackReason: "host-stage-headroom-insufficient",
    },
    hostPressure: {
      observedAt: "2026-08-09T05:41:35.000Z",
      availableMemoryBytes: 35_648_241_664,
    },
  };

  writeLocalCiGateState(stateFile, {
    ...shared,
    status: "queued",
    admission,
  });
  writeLocalCiGateState(stateFile, {
    ...shared,
    status: "failed",
  });

  const state = readLocalCiGateState(stateFile);
  assert.deepEqual(state.admission, admission);
});

// BI-5529B5AC: when one slot PASSES a branch+SHA, a sibling slot's non-passing
// record for the SAME branch+SHA is a loser that would otherwise linger as a
// live-looking claim (the shadow that refused a real PASS on 2026-09-02). It is
// rewritten as `superseded`, naming the winner; records for other SHAs, other
// branches, real passes, and pending evidence are left alone.
test("a losing sibling record for the same branch+SHA is rewritten as superseded", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-supersede-"));
  const winner = join(dir, "dpf-local-ci-gate-slot-1.json");
  const loser = join(dir, "dpf-local-ci-gate.json");
  const base = { leaseId: "L", evidenceId: "", expiresAt: "2026-09-03T02:00:00.000Z", resilience: null, leaseEvents: [] };
  writeLocalCiGateState(loser, { ...base, branch: "feat/x", sha: "abc", gatePassed: false, status: "queued" });
  writeLocalCiGateState(winner, { ...base, branch: "feat/x", sha: "abc", gatePassed: true, status: "passed", evidenceId: "E1" });

  const result = supersedeLosingSlotRecords({
    winnerStateFile: winner,
    winnerSlotKey: "slot-1",
    siblingStateFiles: [loser],
    branch: "feat/x",
    sha: "abc",
    now: () => "2026-09-03T01:00:00.000Z",
  });

  assert.deepEqual(result.superseded, [loser]);
  const rewritten = readLocalCiGateState(loser);
  assert.equal(rewritten.status, "superseded");
  assert.equal(rewritten.gatePassed, false);
  assert.equal(rewritten.supersededStatus, "queued");
  assert.deepEqual(rewritten.supersededBy, { slotKey: "slot-1", stateFile: winner, at: "2026-09-03T01:00:00.000Z" });
  assert.equal(rewritten.sha, "abc");
});

test("supersession leaves other SHAs, other branches, passes, and pending evidence untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-supersede-skip-"));
  const winner = join(dir, "dpf-local-ci-gate-slot-1.json");
  const base = { leaseId: "L", evidenceId: "", expiresAt: "2026-09-03T02:00:00.000Z", resilience: null, leaseEvents: [] };
  const otherSha = join(dir, "a.json");
  const otherBranch = join(dir, "b.json");
  const realPass = join(dir, "c.json");
  const pending = join(dir, "d.json");
  const missing = join(dir, "e.json");
  writeLocalCiGateState(otherSha, { ...base, branch: "feat/x", sha: "old", gatePassed: false, status: "failed" });
  writeLocalCiGateState(otherBranch, { ...base, branch: "feat/y", sha: "abc", gatePassed: false, status: "failed" });
  writeLocalCiGateState(realPass, { ...base, branch: "feat/x", sha: "abc", gatePassed: true, status: "passed", evidenceId: "E0" });
  writeLocalCiGateState(pending, { ...base, branch: "feat/x", sha: "abc", gatePassed: true, status: "passed", evidencePending: true, evidencePendingReason: "quiescing" });

  const result = supersedeLosingSlotRecords({
    winnerStateFile: winner,
    winnerSlotKey: "slot-1",
    siblingStateFiles: [otherSha, otherBranch, realPass, pending, missing],
    branch: "feat/x",
    sha: "abc",
  });

  assert.deepEqual(result.superseded, []);
  for (const file of [otherSha, otherBranch, realPass, pending]) {
    assert.notEqual(readLocalCiGateState(file).status, "superseded", file);
  }
});

// BI-FFCFCCE0: a starvation event that arrives AFTER a terminal PASS is a
// separate inconclusive observation, not a re-verdict. Observed 2026-09-10 on
// fix/principle-decide-requires-option-id: the gate passed and reported PASS at
// 05:55Z, and at 06:15Z the same slot record was rewritten to
// blocked_control_plane_starvation with gatePassed:false and an empty
// evidenceRecordId. One lease, one run — the verdict was reached, then erased.
test("an infrastructure-blocked write cannot downgrade a terminal PASS for the same branch+SHA", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-pass-guard-")), "gate.json");
  const shared = { branch: "fix/x", sha: "d".repeat(40), leaseId: "NPEL-1", resilience: null, leaseEvents: [] };

  writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: true,
    evidenceId: "cmtv4u0220h4301qn5r8le9ev",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
  });
  const result = writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: false,
    evidenceId: "",
    status: "blocked_control_plane_starvation",
    expiresAt: "2026-09-11T06:00:00.000Z",
    evidencePending: true,
    evidencePendingReason: "control_plane_unavailable",
    failureReason: "control plane unreachable for two sustained rounds",
  });

  const state = readLocalCiGateState(stateFile);
  assert.equal(state.gatePassed, true, "the reached verdict must stand");
  assert.equal(state.status, "passed");
  assert.equal(state.evidenceRecordId, "cmtv4u0220h4301qn5r8le9ev");
  assert.equal(result.preservedPass, true);
  // The event is not swallowed: it is recorded as its own inconclusive observation.
  assert.equal(state.inconclusiveObservations.length, 1);
  assert.equal(state.inconclusiveObservations[0].status, "blocked_control_plane_starvation");
  assert.equal(
    state.inconclusiveObservations[0].reason,
    "control plane unreachable for two sustained rounds",
  );
});

test("a PASS whose evidence is still pending is protected the same way", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-pass-pending-")), "gate.json");
  const shared = { branch: "fix/x", sha: "e".repeat(40), leaseId: "NPEL-2", resilience: null, leaseEvents: [] };

  writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: true,
    evidenceId: "",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
    evidencePending: true,
    evidencePendingReason: "tool_threw",
  });
  writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: false,
    evidenceId: "",
    status: "blocked_child_signal_death",
    expiresAt: "2026-09-11T06:00:00.000Z",
  });

  const state = readLocalCiGateState(stateFile);
  assert.equal(state.gatePassed, true);
  assert.equal(state.evidencePending, true);
  assert.equal(state.evidencePendingReason, "tool_threw");
});

test("a real verdict, a different candidate, and a re-run in flight still overwrite a PASS", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-gate-pass-overwrite-"));
  const base = { leaseId: "L", evidenceId: "", resilience: null, leaseEvents: [], expiresAt: "2026-09-11T06:00:00.000Z" };
  const pass = { ...base, gatePassed: true, status: "passed", evidenceId: "E1" };

  // A FAIL for the same tree is a claim about the diff, not infrastructure.
  const verdict = join(dir, "verdict.json");
  writeLocalCiGateState(verdict, { ...pass, branch: "fix/x", sha: "abc" });
  writeLocalCiGateState(verdict, { ...base, branch: "fix/x", sha: "abc", gatePassed: false, status: "failed" });
  assert.equal(readLocalCiGateState(verdict).status, "failed");

  // A blocked write for a DIFFERENT sha describes a different candidate.
  const other = join(dir, "other.json");
  writeLocalCiGateState(other, { ...pass, branch: "fix/x", sha: "abc" });
  writeLocalCiGateState(other, {
    ...base, branch: "fix/x", sha: "def", gatePassed: false, status: "blocked_control_plane_starvation",
  });
  assert.equal(readLocalCiGateState(other).sha, "def");

  // A re-run in flight must own the record; a stale PASS beside a live run lies.
  const rerun = join(dir, "rerun.json");
  writeLocalCiGateState(rerun, { ...pass, branch: "fix/x", sha: "abc" });
  writeLocalCiGateState(rerun, { ...base, branch: "fix/x", sha: "abc", gatePassed: false, status: "running" });
  assert.equal(readLocalCiGateState(rerun).status, "running");
});

test("every blocked_* status counts as infrastructure, including ones added later", () => {
  for (const status of [
    "blocked_control_plane_starvation",
    "blocked_child_signal_death",
    "blocked_sandbox_drift",
    "blocked_quiescence",
    "blocked_wrapper_exited",
    "blocked_something_nobody_has_written_yet",
  ]) {
    assert.equal(isInconclusiveLocalCiGateStatus(status), true, status);
  }
  // Verdicts about the tree are not infrastructure and must stay able to
  // replace a stale PASS.
  for (const status of ["passed", "failed", "conflict", "superseded", "running", "queued", null, undefined]) {
    assert.equal(isInconclusiveLocalCiGateStatus(status), false, String(status));
  }
});

test("a wrapper that exited before a terminal state cannot withdraw a PASS either", () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), "dpf-gate-wrapper-")), "gate.json");
  const shared = { branch: "fix/x", sha: "a".repeat(40), leaseId: "NPEL-3", resilience: null, leaseEvents: [] };

  writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: true,
    evidenceId: "E9",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
  });
  writeLocalCiGateState(stateFile, {
    ...shared,
    gatePassed: false,
    evidenceId: "",
    status: "blocked_wrapper_exited",
    expiresAt: "2026-09-11T06:00:00.000Z",
  });

  assert.equal(readLocalCiGateState(stateFile).status, "passed");
});
