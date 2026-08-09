import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isRecoverableInterruptedGateState,
  readLocalCiGateState,
  writeLocalCiGateState,
} from "./local-ci-gate-state.mjs";

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
