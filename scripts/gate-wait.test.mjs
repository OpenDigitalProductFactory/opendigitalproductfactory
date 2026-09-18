// scripts/gate-wait.test.mjs — BI-22E11EA2
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyGateExit, GATE_EXIT } from "./lib/gate-exit-classification.mjs";
import { delayForAttempt, waitForGate } from "./gate-wait.mjs";

const noSleep = async () => {};

test("infrastructure exits are inconclusive, not a verdict about the diff", () => {
  for (const code of [GATE_EXIT.DURABLE_WAIT, GATE_EXIT.CONTROL_PLANE_STARVATION, GATE_EXIT.CHILD_SIGNAL_DEATH, GATE_EXIT.ABANDONED_OR_UNRECORDED]) {
    const v = classifyGateExit({ code });
    assert.equal(v.retry, true, `exit ${code} must retry`);
    assert.equal(v.verdict, "none", `exit ${code} must not carry a verdict`);
  }
});

test("exit 1 carrying lease-lost text is infrastructure, not a failing diff", () => {
  const v = classifyGateExit({ code: 1, output: "gate-worktree: local-CI lease authority lost while waiting for the host process fence" });
  assert.equal(v.kind, "lease-lost");
  assert.equal(v.retry, true);
  assert.equal(v.verdict, "none");
});

test("a plain exit 1 is a real failure and stops immediately", () => {
  const v = classifyGateExit({ code: 1, output: "FAIL lib/foo.test.ts" });
  assert.equal(v.verdict, "fail");
  assert.equal(v.retry, false);
});

test("sandbox drift does not spin — retrying cannot converge a sandbox", () => {
  const v = classifyGateExit({ code: GATE_EXIT.SANDBOX_DRIFT });
  assert.equal(v.retry, false);
  assert.equal(v.verdict, "none");
  assert.match(v.next, /converge the sandbox/);
});

test("evidence-pending is a PASS that needs finalizing, not a failure", () => {
  const v = classifyGateExit({ code: GATE_EXIT.EVIDENCE_PENDING });
  assert.equal(v.verdict, "pass");
  assert.equal(v.retry, false);
  assert.match(v.next, /--finalize-evidence/);
});

const noStatus = async () => ({ verdict: "NO-RECORD" });

test("a PASS already recorded for this HEAD is never re-gated (BI-1669E08A)", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: "PASS" }),
    runGate: async () => { gateCalls++; return { code: 0 }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(gateCalls, 0, "re-invoking the gate would start a run whose verdict supersedes the pass");
});

test("a FAIL recorded for this HEAD is reported without re-running the gate", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: "FAIL" }),
    runGate: async () => { gateCalls++; return { code: 0 }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
  assert.equal(gateCalls, 0);
});

test("after a queue it WATCHES the status instead of re-claiming the gate", async () => {
  // The runbook: on exit 75 the claim goes to a detached resumer and the caller
  // must stop polling the gate. Re-invoking would start a second run of the
  // same tree.
  let gateCalls = 0;
  const statuses = ["NO-RECORD", "NO-RECORD", "NO-RECORD", "PASS"];
  let i = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: statuses[Math.min(i++, statuses.length - 1)] }),
    runGate: async () => { gateCalls++; return { code: GATE_EXIT.DURABLE_WAIT }; },
    sleep: noSleep,
    watchCyclesAfterQueue: 3,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(gateCalls, 1, "the gate is claimed once; the resumer is then watched, not raced");
});

test("re-claims only after the watch window elapses with still no verdict", async () => {
  // Covers resumeOwner: "caller" — a queued row dies if no local process
  // re-claims it, so watching forever would strand the run.
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => { gateCalls++; return { code: GATE_EXIT.DURABLE_WAIT }; },
    sleep: noSleep,
    watchCyclesAfterQueue: 2,
    deadlineMinutes: 1,
    now: (() => { let t = 0; return () => (t += 15_000); })(),
  });
  assert.equal(result.outcome, "deadline");
  assert.ok(gateCalls >= 1, "must re-claim rather than watch a dead row forever");
});

test("surfaces a genuine failure on the first attempt without burning the queue", async () => {
  let calls = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => { calls++; return { code: 1 }; },
    sleep: noSleep,
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
});

test("a deadline with no verdict exits 7 — never 0, never 1", async () => {
  let clock = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => ({ code: GATE_EXIT.DURABLE_WAIT }),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    deadlineMinutes: 1,
  });
  assert.equal(result.outcome, "deadline");
  assert.equal(result.exitCode, GATE_EXIT.ABANDONED_OR_UNRECORDED);
  assert.notEqual(result.exitCode, 0, "a run that never gated must not read as a pass");
  assert.notEqual(result.exitCode, 1, "a run that never gated must not read as a failing diff");
});

test("an unreadable status is treated as no verdict, never as a pass", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => null,
    runGate: async () => { gateCalls++; return { code: 1 }; },
    sleep: noSleep,
  });
  assert.equal(gateCalls, 1);
  assert.equal(result.outcome, "failed");
});

test("backoff ramps and then holds", () => {
  assert.equal(delayForAttempt(1), 20);
  assert.equal(delayForAttempt(3), 40);
  assert.equal(delayForAttempt(99), 60);
});
