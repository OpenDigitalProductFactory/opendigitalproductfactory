import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RESUME_INTERVAL_MS,
  RESUME_MARKER_ENV,
  buildResumerInvocation,
  shouldSpawnResumer,
  spawnDurableWaitResumer,
} from "./durable-wait-resumer.mjs";
import { resumeUntilAdmitted } from "../local-ci-durable-wait-resumer.mjs";

const GATE_ARGV = ["/usr/bin/node", "/repo/scripts/gate-worktree.mjs", "--branch", "fix/x"];

function stubChild(pid = 4242) {
  return { pid, unref() { this.unrefCalled = true; }, unrefCalled: false };
}

// BI-D35B85BF. The defect this whole module exists to close: a queued gate
// exited 75 and nothing ever re-claimed for it. The wake the platform sent was
// a TaskRun projection with no reader.
test("a queued gate hands its claim to a resumer instead of exiting bare", () => {
  const calls = [];
  const result = spawnDurableWaitResumer({
    runnerPath: "/repo/scripts/local-ci-durable-wait-resumer.mjs",
    gateArgv: GATE_ARGV,
    observerDirectory: "/repo/.git/dpf-local-ci-queue-observers",
    branch: "fix/x",
    sha: "abc123",
    ownerSessionId: "session-1",
    cwd: "/repo",
    env: {},
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return stubChild();
    },
  });

  assert.equal(result.spawned, true);
  assert.equal(result.pid, 4242);
  assert.equal(calls.length, 1);
  // Detached with no inherited stdio, or the resumer dies with the session the
  // gate is about to free.
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
});

test("the resumer replays the gate's own argv rather than a reconstructed one", () => {
  const { args } = buildResumerInvocation({
    runnerPath: "/repo/scripts/local-ci-durable-wait-resumer.mjs",
    gateArgv: GATE_ARGV,
  });
  const gateArgs = args.slice(args.indexOf("--") + 1);
  assert.deepEqual(gateArgs, GATE_ARGV.slice(1));
});

test("observer context travels to the resumer so the queued row stays backed between re-claims", () => {
  const { args } = buildResumerInvocation({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    observerDirectory: "/observers",
    branch: "fix/x",
    sha: "abc123",
    ownerSessionId: "session-1",
  });
  assert.equal(args[args.indexOf("--observer-dir") + 1], "/observers");
  assert.equal(args[args.indexOf("--branch") + 1], "fix/x");
  assert.equal(args[args.indexOf("--sha") + 1], "abc123");
  assert.equal(args[args.indexOf("--owner-session-id") + 1], "session-1");
});

// Without this guard every re-claim forks another waiter, which is a worse
// failure than the one being fixed.
test("a resumer's own gate run never spawns a second resumer", () => {
  assert.equal(shouldSpawnResumer({}), true);
  assert.equal(shouldSpawnResumer({ [RESUME_MARKER_ENV]: "1" }), false);

  let spawned = 0;
  const result = spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    env: { [RESUME_MARKER_ENV]: "1" },
    spawnFn: () => { spawned += 1; return stubChild(); },
  });
  assert.equal(result.spawned, false);
  assert.equal(result.reason, "already-resuming");
  assert.equal(spawned, 0);
});

test("the marker is set on the spawned resumer's environment", () => {
  let seen = null;
  spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    env: { EXISTING: "kept" },
    spawnFn: (_command, _args, options) => { seen = options.env; return stubChild(); },
  });
  assert.equal(seen[RESUME_MARKER_ENV], "1");
  assert.equal(seen.EXISTING, "kept");
});

// A resumer that cannot start must not take the gate down with it: the claim is
// already queued, and the gate's own report says who owns the resume.
test("a failed spawn is reported, not thrown", () => {
  const result = spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    env: {},
    spawnFn: () => { throw new Error("EACCES"); },
  });
  assert.equal(result.spawned, false);
  assert.match(result.reason, /spawn-failed: EACCES/);
});

test("buildResumerInvocation refuses an argv that cannot be replayed", () => {
  assert.throws(
    () => buildResumerInvocation({ runnerPath: "/runner.mjs", gateArgv: ["/usr/bin/node"] }),
    /full process\.argv/,
  );
});

test("the default re-claim interval stays inside the lease's 120s admitted TTL", () => {
  // A waiter that beats less often than the TTL reads as stale to
  // waiterProvesLiveness and can be skipped for staleness by the very admission
  // pass it is waiting on.
  assert.ok(DEFAULT_RESUME_INTERVAL_MS < 120_000);
});

test("the resumer keeps re-claiming while the gate says queued, then stops on a verdict", async () => {
  const codes = [75, 75, 0];
  let attempt = 0;
  const slept = [];
  const { code, attempts } = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 20_000,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async (ms) => { slept.push(ms); },
    spawnFn: () => {
      const code = codes[attempt];
      attempt += 1;
      return {
        once(event, handler) { if (event === "exit") queueMicrotask(() => handler(code)); },
      };
    },
  });

  assert.equal(code, 0, "the gate's own verdict is what the resumer returns");
  assert.equal(attempts, 3);
  assert.deepEqual(slept, [20_000, 20_000]);
});

test("the resumer gives up at its deadline instead of looping forever", async () => {
  let clock = 0;
  const { code } = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 1_000,
    deadlineMs: 2_000,
    env: {},
    now: () => { clock += 1_500; return clock; },
    sleepFn: async () => {},
    spawnFn: () => ({
      once(event, handler) { if (event === "exit") queueMicrotask(() => handler(75)); },
    }),
  });
  assert.equal(code, 75, "still queued at the deadline is still queued, not a FAIL");
});

// report-only-the-verdict-you-reached: a spawn that never started is
// infrastructure, so it is retried rather than recorded as the gate's answer.
test("a resumer spawn error is retried, never reported as a gate verdict", async () => {
  const outcomes = ["error", 0];
  let attempt = 0;
  const { code, attempts } = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 10,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async () => {},
    spawnFn: () => {
      const outcome = outcomes[attempt];
      attempt += 1;
      return {
        once(event, handler) {
          if (outcome === "error" && event === "error") queueMicrotask(() => handler(new Error("ENOENT")));
          if (outcome !== "error" && event === "exit") queueMicrotask(() => handler(outcome));
        },
      };
    },
  });
  assert.equal(code, 0);
  assert.equal(attempts, 2);
});
