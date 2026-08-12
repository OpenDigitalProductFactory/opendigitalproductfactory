import assert from "node:assert/strict";
import test from "node:test";

import {
  WINDOWS_WRAPPER_TERMINATED_STATUS,
  createQueuedGateRevivalWindow,
  gateArgsForQueuedRevivalWindow,
  runGateWithQueuedRevival,
  detectWorkingShell,
  recoverInterruptedGateState,
  reviveInterruptedQueuedGateState,
  shouldUseShell,
} from "./pregate.mjs";

test("queued gate revivals share the original bounded admission deadline", () => {
  const startedAtMs = Date.parse("2026-08-12T03:00:00.000Z");
  const window = createQueuedGateRevivalWindow({
    args: ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "7200"],
    env: {},
    nowMs: startedAtMs,
  });

  assert.equal(window.deadlineMs, startedAtMs + 7_200_000);
  assert.deepEqual(
    gateArgsForQueuedRevivalWindow({
      args: ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "7200"],
      window,
      nowMs: startedAtMs + 1_800_123,
    }),
    ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "5400"],
  );
  assert.deepEqual(
    gateArgsForQueuedRevivalWindow({
      args: ["--branch", "fix/local-ci-survival"],
      window,
      nowMs: window.deadlineMs,
    }),
    null,
  );
});

test("queued gate survival is bounded by time rather than an arbitrary revival count", async () => {
  const wrapperExit = { status: WINDOWS_WRAPPER_TERMINATED_STATUS, signal: null };
  const results = Array.from({ length: 7 }, () => wrapperExit).concat({ status: 0, signal: null });
  const invocations = [];
  const revivals = [];
  let recovered = false;
  let nowMs = Date.parse("2026-08-12T03:00:00.000Z");

  const outcome = await runGateWithQueuedRevival({
    args: ["--lease-wait-seconds", "7200"],
    useShell: false,
    now: () => nowMs,
    spawnSyncImpl: (_command, args) => {
      invocations.push(args);
      nowMs += 300_000;
      return results.shift();
    },
    reviveInterruptedQueuedGateImpl: async ({ result }) => {
      revivals.push(result.status);
      return { revived: true, leaseId: "NPEL-STABLE" };
    },
    recoverInterruptedGateImpl: async () => {
      recovered = true;
    },
    stderr: { write() {} },
  });

  assert.equal(outcome.result.status, 0);
  assert.equal(outcome.queuedRevivals, 7);
  assert.equal(invocations.length, 8);
  assert.equal(revivals.length, 7);
  assert.equal(recovered, false);
  assert.equal(invocations.at(-1).at(-1), "5100");
});

function shellProbe(status = 0) {
  return () => ({
    status,
    error: null,
    stdout: status === 0 ? "/tmp/worktree\n" : "",
  });
}

test("pregate routes to the canonical Node gate by default even when sh works", () => {
  assert.equal(detectWorkingShell({ spawnSyncImpl: shellProbe(0) }), true);
  assert.equal(shouldUseShell({ env: {}, spawnSyncImpl: shellProbe(0) }), false);
});

test("pregate shell route is explicit and still requires a working shell", () => {
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1" },
    spawnSyncImpl: shellProbe(0),
  }), true);
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1" },
    spawnSyncImpl: shellProbe(1),
  }), false);
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1", DPF_PREGATE_FORCE_NODE: "1" },
    spawnSyncImpl: shellProbe(0),
  }), false);
});

test("pregate recovery releases an interrupted running gate and marks it failed", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-descendant-fence",
      sha: "a".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-INTERRUPTED",
      evidenceRecordId: "",
      status: "running",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "admitted", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
    },
    branch: "fix/local-ci-descendant-fence",
    sha: "a".repeat(40),
    childStatus: 1,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:01:00.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.releaseSucceeded, true);
  assert.deepEqual(calls, [{
    tool: "release_nonprod_environment_lease",
    args: { leaseId: "NPEL-INTERRUPTED" },
  }]);
  assert.equal(written.status, "failed");
  assert.equal(written.gatePassed, false);
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_gate_recovery");
  assert.equal(written.recovery.reason, "gate-wrapper-exited-before-terminal-state");
});

test("pregate recovery releases an interrupted queued gate and marks it failed", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-queued-recovery",
      sha: "c".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-QUEUED",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
      queueObserver: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
        pid: 12345,
        ownerSessionId: "test-owner",
      },
    },
    branch: "fix/local-ci-queued-recovery",
    sha: "c".repeat(40),
    childStatus: 4294967295,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    releaseLocalQueueObserverImpl: (args) => {
      calls.push({ tool: "releaseLocalQueueObserver", args });
      return { status: "released" };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:02:00.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.releaseSucceeded, true);
  assert.deepEqual(calls, [
    {
      tool: "release_nonprod_environment_lease",
      args: { leaseId: "NPEL-QUEUED" },
    },
    {
      tool: "releaseLocalQueueObserver",
      args: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
      },
    },
  ]);
  assert.equal(written.status, "failed");
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_gate_recovery");
  assert.equal(written.recovery.childStatus, 4294967295);
  assert.equal(written.recovery.queueObserverReleaseStatus, "released");
});

test("pregate recovery falls back to dead observer cleanup by gate identity", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-fallback-cleanup",
      sha: "d".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-FALLBACK",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
    },
    branch: "fix/local-ci-fallback-cleanup",
    sha: "d".repeat(40),
    childStatus: 1,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    releaseDeadLocalQueueObserversForGateImpl: (args) => {
      calls.push({ tool: "releaseDeadLocalQueueObserversForGate", args });
      return [{
        observerToken: "fallback-token",
        pid: 12345,
        branch: args.branch,
        sha: args.sha,
        releaseStatus: "released",
      }];
    },
    queueObserverFallbackDirectory: "/tmp/dpf-local-ci-queue-observers",
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:02:30.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.deepEqual(calls, [
    {
      tool: "release_nonprod_environment_lease",
      args: { leaseId: "NPEL-FALLBACK" },
    },
    {
      tool: "releaseDeadLocalQueueObserversForGate",
      args: {
        directory: "/tmp/dpf-local-ci-queue-observers",
        branch: "fix/local-ci-fallback-cleanup",
        sha: "d".repeat(40),
      },
    },
  ]);
  assert.equal(written.recovery.queueObserverReleaseStatus, "fallback-released:1");
  assert.equal(written.recovery.queueObserverFallbackReleases.length, 1);
});

test("pregate revival preserves an interrupted queued gate lease", async () => {
  const calls = [];
  let written = null;
  const revived = await reviveInterruptedQueuedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-queued-revival",
      sha: "e".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-QUEUED-REVIVE",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
      queueObserver: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
        pid: 12345,
        ownerSessionId: "test-owner",
      },
    },
    branch: "fix/local-ci-queued-revival",
    sha: "e".repeat(40),
    childStatus: WINDOWS_WRAPPER_TERMINATED_STATUS,
    releaseLocalQueueObserverImpl: (args) => {
      calls.push({ tool: "releaseLocalQueueObserver", args });
      return { status: "released" };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:03:00.000Z",
  });

  assert.equal(revived.revived, true);
  assert.equal(revived.leaseId, "NPEL-QUEUED-REVIVE");
  assert.deepEqual(calls, [{
    tool: "releaseLocalQueueObserver",
    args: {
      path: "/tmp/dpf-local-ci-observer.json",
      token: "observer-token",
    },
  }]);
  assert.equal(written.status, "queued");
  assert.equal(written.gatePassed, false);
  assert.equal(written.leaseId, "NPEL-QUEUED-REVIVE");
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_queue_revival");
  assert.equal(written.recovery.reason, "queued-gate-wrapper-exited-resuming");
  assert.equal(written.recovery.leasePreserved, true);
});

test("pregate revival refuses non-queued interrupted states", async () => {
  let wrote = false;
  const revived = await reviveInterruptedQueuedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-running-recovery",
      sha: "f".repeat(40),
      leaseId: "NPEL-RUNNING",
      status: "running",
      evidencePending: false,
    },
    branch: "fix/local-ci-running-recovery",
    sha: "f".repeat(40),
    childStatus: WINDOWS_WRAPPER_TERMINATED_STATUS,
    writeStateImpl: () => {
      wrote = true;
    },
  });

  assert.equal(revived.revived, false);
  assert.equal(wrote, false);
});

test("pregate recovery ignores terminal gate states", async () => {
  let releaseCalled = false;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-descendant-fence",
      sha: "b".repeat(40),
      leaseId: "NPEL-TERMINAL",
      status: "failed",
      evidencePending: false,
    },
    branch: "fix/local-ci-descendant-fence",
    sha: "b".repeat(40),
    bearerToken: "test-token",
    mcpCallImpl: async () => {
      releaseCalled = true;
      return { success: true };
    },
    writeStateImpl: () => {
      throw new Error("terminal states must not be rewritten");
    },
  });

  assert.equal(recovered.recovered, false);
  assert.equal(releaseCalled, false);
});
