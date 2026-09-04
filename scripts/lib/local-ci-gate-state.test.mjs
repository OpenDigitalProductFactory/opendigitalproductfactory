import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLocalCiPassEvidenceValidity,
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
