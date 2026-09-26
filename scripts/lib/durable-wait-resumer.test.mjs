import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_RESUME_INTERVAL_MS,
  RESUME_MARKER_ENV,
  buildResumerInvocation,
  pinnedGateFlags,
  shouldSpawnResumer,
  spawnDurableWaitResumer,
} from "./durable-wait-resumer.mjs";
import { runBreakawayLaunch, spawnOutsideCallerJob } from "./win32-job-breakaway.mjs";
import {
  EXIT_QUEUED,
  INFRASTRUCTURE_BACKOFF_MS,
  RETRYABLE_EXITS,
  classifyResumeOutcome,
  isRetryableExit,
  parseResumerArgs,
  resumeUntilAdmitted,
} from "../local-ci-durable-wait-resumer.mjs";
import {
  EXIT_CONTROL_PLANE_STARVATION,
  EXIT_SANDBOX_DRIFT,
  EXIT_SOURCE_DRIFT,
  EXIT_WAIT_CANCELLED,
  classifyGateOutcome,
} from "./sandbox-freshness.mjs";

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
  // Windows: a console-less process must never open a terminal window.
  assert.equal(calls[0].options.windowsHide, true);
});

// Observed live 2026-09-22: six resumers re-claiming every 20s each opened a
// Windows Terminal window that took keyboard focus from the operator. The
// resumer is detached, so it has no console; a console child it starts without
// windowsHide gets a brand-new VISIBLE one on every attempt.
test("every re-claim runs the gate with its console hidden", async () => {
  const seen = [];
  await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 1,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async () => {},
    spawnFn: (_command, _args, options) => {
      seen.push(options);
      const code = seen.length < 2 ? 75 : 0;
      return { once(event, handler) { if (event === "exit") queueMicrotask(() => handler(code)); } };
    },
  });
  assert.equal(seen.length, 2);
  for (const options of seen) assert.equal(options.windowsHide, true);
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

// The resumer's whole job is to still be there on the second re-claim. The
// first field build unref'd its sleep timer, so between re-claims nothing held
// the event loop open: every resumer exited 0 mid-sleep after exactly one
// attempt, silently, which on the wire looked identical to the defect it was
// written to fix. A unit test cannot see that - only a real child can.
test("the resumer survives its sleep and re-claims more than once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-resumer-"));
  const fakeGate = join(directory, "always-queued-gate.mjs");
  writeFileSync(fakeGate, "process.exit(75);\n");
  chmodSync(fakeGate, 0o755);

  const runner = join(dirname(dirname(fileURLToPath(import.meta.url))), "local-ci-durable-wait-resumer.mjs");
  const child = spawn(process.execPath, [
    runner,
    "--interval-ms", "200",
    "--deadline-ms", "4000",
    "--observer-dir", directory,
    "--branch", "fix/x",
    "--sha", "abc123",
    "--owner-session-id", "session-1",
    "--", fakeGate,
  ], { stdio: "ignore" });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve("still-running"); }, 15_000);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });

  const logFile = readdirSync(directory).find((name) => name.endsWith(".resumer.log"));
  assert.ok(logFile, "the resumer must leave a log; a silent detached process is undiagnosable");
  const attempts = readFileSync(join(directory, logFile), "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "gate-attempt");

  assert.ok(
    attempts.length >= 3,
    `expected the resumer to keep re-claiming across sleeps, got ${attempts.length} attempt(s)`,
  );
  assert.ok(attempts.every((entry) => entry.code === 75));
  assert.equal(exitCode, 75, "still queued at its deadline is still queued, not a verdict");
});

// ── infrastructure is not a verdict (observed live 2026-09-12) ──────────────

// RED for the field defect: attempt 7 returned exit 5, the resumer wrote
// "finished", and the branch was left carrying a phantom FAIL that exact-tree
// reuse replayed. A starved control plane is a host condition, not an answer.
test("a control-plane starvation does not end the wait", async () => {
  const codes = [EXIT_QUEUED, EXIT_CONTROL_PLANE_STARVATION, 0];
  let i = 0;
  const slept = [];
  const { code, attempts, blockedAttempts } = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 20_000,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async (ms) => { slept.push(ms); },
    spawnFn: () => {
      const c = codes[i];
      i += 1;
      return { once(e, h) { if (e === "exit") queueMicrotask(() => h(c)); } };
    },
  });
  assert.equal(code, 0, "the wait ends on the gate's real verdict, not on the starvation");
  assert.equal(attempts, 3);
  assert.equal(blockedAttempts, 1);
  assert.equal(slept[1], INFRASTRUCTURE_BACKOFF_MS, "a host that just starved needs longer than the queue poll");
});

test("a killed build child does not end the wait either", async () => {
  for (const infra of [87, 130, 143]) {
    const codes = [infra, 1];
    let i = 0;
    const { code, attempts } = await resumeUntilAdmitted({
      gateArgv: ["/repo/scripts/gate-worktree.mjs"],
      intervalMs: 10,
      deadlineMs: 3_600_000,
      env: {},
      now: () => 0,
      sleepFn: async () => {},
      spawnFn: () => {
        const c = codes[i];
        i += 1;
        return { once(e, h) { if (e === "exit") queueMicrotask(() => h(c)); } };
      },
    });
    assert.equal(code, 1, `exit ${infra} must be retried, then the real FAIL returned`);
    assert.equal(attempts, 2);
  }
});

test("a product FAIL ends the wait immediately - fail closed on safety", async () => {
  const { code, attempts } = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 10,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async () => {},
    spawnFn: () => ({ once(e, h) { if (e === "exit") queueMicrotask(() => h(1)); } }),
  });
  assert.equal(code, 1);
  assert.equal(attempts, 1, "a real failure must not be retried into a green");
});

// Retrying a drifted sandbox cannot converge it; it would spin to the deadline.
test("sandbox drift is not retried", () => {
  assert.equal(isRetryableExit(EXIT_SANDBOX_DRIFT), false);
});

// The one rule that must never rot: this set is a SUBSET of what the canonical
// classifier calls blocked. If someone reclassifies a code, this fails here
// rather than silently turning an infrastructure blip into a verdict again.
test("every retryable exit is one the canonical classifier calls blocked", () => {
  for (const code of RETRYABLE_EXITS) {
    const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: code });
    assert.equal(
      outcome.productEvidence, false,
      `exit ${code} is treated as retryable but classifyGateOutcome calls it product evidence`,
    );
    assert.match(
      outcome.status, /^blocked_/,
      `exit ${code} is treated as retryable but classifies as "${outcome.status}"`,
    );
  }
});

// ── BI-D35B85BF: a resumed gate is pinned, and a cancellation is final ──────

const PIN = Object.freeze({
  branch: "fix/x",
  sha: "a".repeat(40),
  worktree: "/repo/wt",
  ownerProvider: "claude",
  ownerSessionId: "session-1",
  resumeLeaseId: "NPEL-PINNED",
});

/** The value the gate's parseArgs reads for `flag`: the LAST occurrence wins. */
function lastValue(args, flag) {
  const index = args.lastIndexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

// Root cause 1: the resumer replayed process.argv verbatim, so every re-claim
// re-resolved HEAD, branch and worktree afresh and re-derived the owner id.
test("the pinned candidate is appended after the replayed argv so it wins", () => {
  const replayed = [
    "/usr/bin/node", "/repo/scripts/gate-worktree.mjs",
    "--branch", "fix/other", "--sha", "b".repeat(40), "--worktree", "/elsewhere",
  ];
  const { args } = buildResumerInvocation({
    runnerPath: "/runner.mjs",
    gateArgv: replayed,
    pin: PIN,
  });
  const gateArgs = args.slice(args.indexOf("--") + 1);
  // The replay is still there, byte for byte, so tomorrow's flags still travel.
  assert.deepEqual(gateArgs.slice(0, replayed.length - 1), replayed.slice(1));
  // ...and the pin comes after it, so the gate's last-value-wins parser reads it.
  assert.deepEqual(gateArgs.slice(replayed.length - 1), pinnedGateFlags(PIN));
  assert.equal(lastValue(gateArgs, "--branch"), PIN.branch);
  assert.equal(lastValue(gateArgs, "--sha"), PIN.sha);
  assert.equal(lastValue(gateArgs, "--worktree"), PIN.worktree);
  assert.equal(lastValue(gateArgs, "--owner-provider"), PIN.ownerProvider);
  assert.equal(lastValue(gateArgs, "--owner-session-id"), PIN.ownerSessionId);
  assert.equal(lastValue(gateArgs, "--resume-lease-id"), PIN.resumeLeaseId);
});

test("an empty pin field is omitted rather than pinned to an empty string", () => {
  const flags = pinnedGateFlags({ ...PIN, ownerProvider: "", resumeLeaseId: undefined });
  assert.equal(flags.includes("--owner-provider"), false);
  assert.equal(flags.includes("--resume-lease-id"), false);
  assert.equal(lastValue(flags, "--sha"), PIN.sha);
});

test("the pinned worktree becomes the gate's working directory", () => {
  const { args } = buildResumerInvocation({ runnerPath: "/runner.mjs", gateArgv: GATE_ARGV, pin: PIN });
  const runnerFlags = args.slice(1, args.indexOf("--"));
  assert.equal(lastValue(runnerFlags, "--gate-cwd"), PIN.worktree);
  assert.equal(parseResumerArgs(args.slice(1)).gateCwd, PIN.worktree);
});

test("spawnDurableWaitResumer carries the pin through to the resumer command line", () => {
  let seen = null;
  spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    observerDirectory: "/observers",
    cwd: "/repo/wt",
    env: {},
    pin: PIN,
    spawnFn: (_command, args) => { seen = args; return stubChild(); },
  });
  const gateArgs = seen.slice(seen.indexOf("--") + 1);
  assert.equal(lastValue(gateArgs, "--resume-lease-id"), PIN.resumeLeaseId);
  assert.equal(lastValue(gateArgs, "--owner-session-id"), PIN.ownerSessionId);
  // The observer record speaks for the same owner the gate now pins.
  assert.equal(seen[seen.indexOf("--owner-session-id") + 1], PIN.ownerSessionId);
});

test("every gate attempt runs from an explicit working directory", async () => {
  const seen = [];
  await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 1,
    deadlineMs: 3_600_000,
    cwd: "/repo/wt",
    env: {},
    now: () => 0,
    sleepFn: async () => {},
    spawnFn: (_command, _args, options) => {
      seen.push(options.cwd);
      return { once(event, handler) { if (event === "exit") queueMicrotask(() => handler(0)); } };
    },
  });
  assert.deepEqual(seen, ["/repo/wt"]);
});

// AC-DW-01: an explicit cancellation stops automated reclaims.
for (const [label, stopCode] of [["cancelled", EXIT_WAIT_CANCELLED], ["source-drifted", EXIT_SOURCE_DRIFT]]) {
  test(`a ${label} gate ends the wait after one attempt and is never retried`, async () => {
    let attempts = 0;
    const result = await resumeUntilAdmitted({
      gateArgv: ["/repo/scripts/gate-worktree.mjs"],
      intervalMs: 10,
      deadlineMs: 3_600_000,
      env: {},
      now: () => 0,
      sleepFn: async () => { throw new Error("a stopped wait must not sleep toward another attempt"); },
      spawnFn: () => {
        attempts += 1;
        return { once(e, h) { if (e === "exit") queueMicrotask(() => h(stopCode)); } };
      },
    });
    assert.equal(isRetryableExit(stopCode), false);
    assert.equal(result.code, stopCode);
    assert.equal(result.attempts, 1);
    assert.equal(attempts, 1);
    assert.equal(result.outcome.evidence, "unrun");
  });
}

test("the stop codes collide with no code that already means something", () => {
  assert.notEqual(EXIT_WAIT_CANCELLED, EXIT_SOURCE_DRIFT);
  for (const code of [EXIT_WAIT_CANCELLED, EXIT_SOURCE_DRIFT]) {
    assert.equal(RETRYABLE_EXITS.includes(code), false);
    // 88 is EXIT_STAGE_INCONCLUSIVE / TSC_TERMINATED_EXIT_CODE elsewhere.
    assert.ok(![0, 1, 2, 3, 4, 5, 6, 7, 64, 70, 75, 86, 87, 88, 130, 143].includes(code), `exit ${code} is already taken`);
  }
});

// AC-DW-06: the resumer's own record says whether it ended unrun, inconclusive,
// failed or passed, instead of a bare exit code a reader has to decode.
test("the resume outcome distinguishes unrun, inconclusive, failed and passed", () => {
  assert.deepEqual(classifyResumeOutcome(0), { evidence: "passed", reason: "passed" });
  assert.deepEqual(classifyResumeOutcome(EXIT_WAIT_CANCELLED), { evidence: "unrun", reason: "cancelled" });
  assert.deepEqual(classifyResumeOutcome(EXIT_SOURCE_DRIFT), { evidence: "unrun", reason: "source-drift" });
  assert.deepEqual(classifyResumeOutcome(EXIT_QUEUED), { evidence: "unrun", reason: "still-queued" });
  assert.deepEqual(classifyResumeOutcome(null), { evidence: "unrun", reason: "unlaunched" });
  assert.equal(classifyResumeOutcome(EXIT_CONTROL_PLANE_STARVATION).evidence, "inconclusive");
  assert.equal(classifyResumeOutcome(EXIT_SANDBOX_DRIFT).evidence, "inconclusive");
  assert.deepEqual(classifyResumeOutcome(1), { evidence: "failed", reason: "failed" });
});

test("eventual admission still ends on the gate's own verdict after queued attempts", async () => {
  const codes = [EXIT_QUEUED, EXIT_QUEUED, 0];
  let attempt = 0;
  const result = await resumeUntilAdmitted({
    gateArgv: ["/repo/scripts/gate-worktree.mjs"],
    intervalMs: 5,
    deadlineMs: 3_600_000,
    env: {},
    now: () => 0,
    sleepFn: async () => {},
    spawnFn: () => {
      const code = codes[attempt];
      attempt += 1;
      return { once(e, h) { if (e === "exit") queueMicrotask(() => h(code)); } };
    },
  });
  assert.equal(result.code, 0);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.outcome, { evidence: "passed", reason: "passed" });
});

// A real child: the working directory and the stop both have to survive the
// detached process boundary, which an injected spawn cannot see.
test("a real resumer stops on a cancelled gate and ran it from the pinned worktree", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-resumer-cancel-"));
  const pinnedWorktree = mkdtempSync(join(tmpdir(), "dpf-resumer-wt-"));
  const cwdFile = join(directory, "gate-cwd.txt");
  const fakeGate = join(directory, "cancelled-gate.mjs");
  writeFileSync(fakeGate, [
    'import { appendFileSync } from "node:fs";',
    `appendFileSync(${JSON.stringify(cwdFile)}, process.cwd() + "\\n");`,
    `process.exit(${EXIT_WAIT_CANCELLED});`,
    "",
  ].join("\n"));

  const runner = join(dirname(dirname(fileURLToPath(import.meta.url))), "local-ci-durable-wait-resumer.mjs");
  const child = spawn(process.execPath, [
    runner,
    "--interval-ms", "100",
    "--deadline-ms", "10000",
    "--observer-dir", directory,
    "--gate-cwd", pinnedWorktree,
    "--", fakeGate,
  ], { stdio: "ignore", cwd: directory });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve("still-running"); }, 15_000);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });

  assert.equal(exitCode, EXIT_WAIT_CANCELLED, "a cancelled wait must end, not keep re-claiming");
  const cwds = readFileSync(cwdFile, "utf8").split(/\r?\n/).filter(Boolean);
  assert.equal(cwds.length, 1, "exactly one attempt: a cancellation is never retried");
  assert.equal(realpathSync(cwds[0]), realpathSync(pinnedWorktree));
  const logFile = readdirSync(directory).find((name) => name.endsWith(".resumer.log"));
  const finished = readFileSync(join(directory, logFile), "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .find((entry) => entry.event === "finished");
  assert.deepEqual(finished.outcome, { evidence: "unrun", reason: "cancelled" });
});

// ─── BI-27A37D27: the resumer must outlive the client session on Windows ────
//
// Measured 2026-09-26: node's `detached: true` does not take a Windows child out
// of the caller's JOB OBJECT. Every resumer sat in the same job as claude.exe
// (IsProcessInJob=true) and died with the session, so a queued gate lapsed while
// pregate:status kept saying "queued". A process created through WMI
// Win32_Process.Create is parented by WmiPrvSE and is in no job.

function breakawayHarness({ stdout = "0 5151", throws = null } = {}) {
  const calls = { exec: [], spawn: [], specs: [] };
  const stateDirectory = mkdtempSync(join(tmpdir(), "dpf-breakaway-"));
  const deps = {
    stateDirectory,
    launcherPath: "/repo/scripts/lib/win32-job-breakaway.mjs",
    nodePath: "C:/node/node.exe",
    execFileSyncImpl: (file, args, options) => {
      calls.exec.push({ file, args, options });
      const specPath = options.env.DPF_BREAKAWAY_SPEC;
      calls.specs.push(JSON.parse(readFileSync(specPath, "utf8")));
      if (throws) throw new Error(throws);
      return stdout;
    },
    nodeSpawn: (command, args, options) => {
      calls.spawn.push({ command, args, options });
      return stubChild(777);
    },
  };
  return { calls, deps };
}

test("on Windows the resumer is created through WMI, outside the caller's job (BI-27A37D27)", () => {
  const { calls, deps } = breakawayHarness();
  const child = spawnOutsideCallerJob(
    "C:/node/node.exe",
    ["/repo/scripts/local-ci-durable-wait-resumer.mjs", "--branch", "fix/x"],
    { cwd: "D:/repo", env: { DPF_MCP_BEARER_TOKEN: "t", [RESUME_MARKER_ENV]: "1" } },
    deps,
  );

  assert.equal(child.pid, 5151);
  assert.equal(child.via, "wmi-breakaway");
  assert.equal(child.sessionBound, false);
  assert.equal(calls.spawn.length, 0, "no in-job fallback when WMI succeeded");
  assert.equal(calls.exec[0].file, "powershell.exe");
  assert.match(calls.exec[0].args.join(" "), /Win32_Process/);
  assert.match(calls.exec[0].args.join(" "), /Create/);
  // The launch spec carries the exact command, cwd and environment, so the
  // job-escaped process runs with the session's credentials and marker.
  assert.deepEqual(calls.specs[0].args, ["/repo/scripts/local-ci-durable-wait-resumer.mjs", "--branch", "fix/x"]);
  assert.equal(calls.specs[0].cwd, "D:/repo");
  assert.equal(calls.specs[0].env.DPF_MCP_BEARER_TOKEN, "t");
  assert.equal(calls.specs[0].env[RESUME_MARKER_ENV], "1");
  assert.match(calls.exec[0].options.env.DPF_BREAKAWAY_CMD, /win32-job-breakaway\.mjs/);
});

test("a failed WMI launch falls back to the in-job spawn and says the waiter is session-bound", () => {
  const { calls, deps } = breakawayHarness({ throws: "Access denied" });
  const child = spawnOutsideCallerJob("node", ["/r.mjs"], { cwd: "D:/repo", env: {} }, deps);
  assert.equal(child.pid, 777);
  assert.equal(child.sessionBound, true);
  assert.match(child.breakawayError, /Access denied/);
  assert.equal(calls.spawn[0].options.detached, true);
  assert.equal(calls.spawn[0].options.windowsHide, true);
});

test("a non-zero Win32_Process.Create return value is a failed launch, not a pid", () => {
  const { calls, deps } = breakawayHarness({ stdout: "9 0" });
  const child = spawnOutsideCallerJob("node", ["/r.mjs"], { cwd: "D:/repo", env: {} }, deps);
  assert.equal(child.sessionBound, true);
  assert.match(child.breakawayError, /returned 9/);
  assert.equal(calls.spawn.length, 1);
});

test("spawnDurableWaitResumer reports whether its waiter survives the session", () => {
  const bound = spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    env: {},
    spawnFn: () => ({ ...stubChild(31), via: "detached", sessionBound: true }),
  });
  assert.equal(bound.spawned, true);
  assert.equal(bound.survivesSession, false);

  const free = spawnDurableWaitResumer({
    runnerPath: "/runner.mjs",
    gateArgv: GATE_ARGV,
    env: {},
    spawnFn: () => ({ ...stubChild(32), via: "wmi-breakaway", sessionBound: false }),
  });
  assert.equal(free.survivesSession, true);
  assert.equal(free.via, "wmi-breakaway");
});

test("the launcher reads and deletes its spec, then starts the resumer detached with that environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-breakaway-launch-"));
  const specPath = join(dir, "launch.json");
  writeFileSync(specPath, JSON.stringify({
    command: "C:/node/node.exe",
    args: ["/runner.mjs", "--branch", "fix/x"],
    cwd: "D:/repo",
    env: { DPF_MCP_BEARER_TOKEN: "t" },
  }));
  const spawned = [];
  runBreakawayLaunch(specPath, {
    spawnImpl: (command, args, options) => { spawned.push({ command, args, options }); return stubChild(88); },
  });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "C:/node/node.exe");
  assert.deepEqual(spawned[0].args, ["/runner.mjs", "--branch", "fix/x"]);
  assert.equal(spawned[0].options.cwd, "D:/repo");
  assert.equal(spawned[0].options.env.DPF_MCP_BEARER_TOKEN, "t");
  assert.equal(spawned[0].options.detached, true);
  // The spec holds the session environment (credentials included); it must not outlive the launch.
  assert.throws(() => readFileSync(specPath, "utf8"), /ENOENT/);
});

// BI-27A37D27 acceptance: kill the invoking process TREE after the gate hands
// its claim to a resumer, then prove the resumer is still alive and working.
// POSIX: the caller leads its own process group and the whole group is killed;
// Windows: `taskkill /T /F` kills the caller and every descendant by parent pid.
// A resumer that is still a descendant of the caller dies either way.
test("the resumer survives its caller's whole process tree being killed", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-resumer-survival-"));
  const heartbeat = join(dir, "heartbeat.log");
  const runnerPath = join(dir, "stub-resumer.mjs");
  writeFileSync(runnerPath, [
    'import { appendFileSync, writeFileSync } from "node:fs";',
    "const file = process.env.DPF_TEST_HEARTBEAT;",
    'writeFileSync(file + ".pid", String(process.pid));',
    'setInterval(() => appendFileSync(file, "tick\\n"), 100);',
    "setTimeout(() => process.exit(0), 30_000);",
  ].join("\n"));
  const modulePath = fileURLToPath(new URL("./durable-wait-resumer.mjs", import.meta.url));
  const callerPath = join(dir, "caller.mjs");
  writeFileSync(callerPath, [
    `import { spawnDurableWaitResumer } from ${JSON.stringify(pathToFileURL(modulePath).href)};`,
    `const r = spawnDurableWaitResumer({ runnerPath: ${JSON.stringify(runnerPath)}, gateArgv: [process.execPath, "gate.mjs"], cwd: ${JSON.stringify(dir)}, env: { ...process.env, DPF_TEST_HEARTBEAT: ${JSON.stringify(heartbeat)} } });`,
    'process.stdout.write(JSON.stringify(r) + "\\n");',
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const caller = spawn(process.execPath, [callerPath], {
    stdio: ["ignore", "pipe", "inherit"],
    detached: process.platform !== "win32",
  });
  const report = await new Promise((resolve, reject) => {
    let out = "";
    caller.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("\n")) resolve(JSON.parse(out.split("\n")[0]));
    });
    caller.on("error", reject);
  });
  assert.equal(report.spawned, true);
  assert.equal(report.survivesSession, true, `resumer not session-independent: ${report.reason}`);

  const ticks = () => { try { return readFileSync(heartbeat, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && ticks() === 0; i += 1) await sleep(100);
  assert.ok(ticks() > 0, "resumer never started");

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(caller.pid)]);
  } else {
    process.kill(-caller.pid, "SIGKILL");
  }
  await sleep(1_000);
  const before = ticks();
  await sleep(1_000);
  const after = ticks();
  const resumerPid = Number(readFileSync(`${heartbeat}.pid`, "utf8"));
  try { process.kill(resumerPid, "SIGKILL"); } catch { /* already gone would have failed below */ }
  assert.ok(after > before, `resumer stopped when its caller's tree was killed (ticks ${before} -> ${after})`);
});
