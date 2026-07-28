import assert from "node:assert/strict";
import test from "node:test";

import {
  detectWorkingShell,
  recoverInterruptedGateState,
  shouldUseShell,
} from "./pregate.mjs";

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
