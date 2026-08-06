// scripts/check-guards.test.mjs
// node --test (no vitest). Pins the killed-spawn honesty contract of the Repo
// Guard Loop runner (BI-AA2EE621): a guard child the OS refused to launch or
// killed mid-run must be reported as a RUNNER failure, never conflated with a
// guard that found a real violation, and the two must be distinguishable in
// BOTH the exit code and the printed message.

import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNNER_FAILURE_EXIT_CODE,
  SPAWN_OUTCOME,
  classifySpawnResult,
  spawnWithRunnerRetry,
  runGuards,
  summarizeGuardRun,
} from "./check-guards.mjs";

// ── classifySpawnResult — the exact injections the BI requires ───────────────

test("a SIGKILL'd spawn (status:null) is a runner failure, not a violation", () => {
  const c = classifySpawnResult({ status: null, signal: "SIGKILL" });
  assert.equal(c.outcome, SPAWN_OUTCOME.RUNNER_FAILURE);
  assert.match(c.detail, /SIGKILL/);
});

test("a Windows taskkill /T /F (status 4294967295 surfaces as null) is a runner failure", () => {
  // spawnSync reports a signal-terminated child as status:null; the tree-kill
  // the local-CI supervisor issues on eviction lands exactly here.
  const c = classifySpawnResult({ status: null, signal: "SIGTERM" });
  assert.equal(c.outcome, SPAWN_OUTCOME.RUNNER_FAILURE);
});

test("a spawn that never launched (error ENOMEM) is a runner failure, not a violation", () => {
  const c = classifySpawnResult({
    error: Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" }),
    status: null,
  });
  assert.equal(c.outcome, SPAWN_OUTCOME.RUNNER_FAILURE);
  assert.match(c.detail, /ENOMEM/);
});

test("a positive exit status is a genuine guard violation", () => {
  const c = classifySpawnResult({ status: 1 });
  assert.equal(c.outcome, SPAWN_OUTCOME.VIOLATION);
  assert.match(c.detail, /exit 1/);
});

test("exit 0 is clean", () => {
  assert.equal(classifySpawnResult({ status: 0 }).outcome, SPAWN_OUTCOME.OK);
});

// ── retry — a runner failure is transient, a violation is not ────────────────

test("spawnWithRunnerRetry re-spawns a killed guard and accepts a later clean exit", () => {
  let attempts = 0;
  const result = spawnWithRunnerRetry(["x"], {
    maxRetries: 2,
    spawn: () => (++attempts < 2 ? { status: null, signal: "SIGKILL" } : { status: 0 }),
  });
  assert.equal(result.outcome, SPAWN_OUTCOME.OK);
  assert.equal(result.attempts, 2);
});

test("spawnWithRunnerRetry gives up after maxRetries and reports a runner failure", () => {
  let attempts = 0;
  const result = spawnWithRunnerRetry(["x"], {
    maxRetries: 2,
    spawn: () => (attempts++, { status: null, signal: "SIGKILL" }),
  });
  assert.equal(result.outcome, SPAWN_OUTCOME.RUNNER_FAILURE);
  assert.equal(result.attempts, 3); // initial + 2 retries
});

test("spawnWithRunnerRetry never retries a real violation", () => {
  let attempts = 0;
  const result = spawnWithRunnerRetry(["x"], {
    maxRetries: 5,
    spawn: () => (attempts++, { status: 1 }),
  });
  assert.equal(result.outcome, SPAWN_OUTCOME.VIOLATION);
  assert.equal(attempts, 1);
});

// ── runGuards — killed guards land in runnerFailures, not violations ─────────

test("runGuards separates a killed guard from a violating guard", () => {
  const guards = ["check-no-alpha.mjs", "check-no-beta.mjs", "check-no-gamma.mjs"];
  const tests = new Set();
  const spawn = (argv) => {
    const file = String(argv[argv.length - 1]);
    if (file.includes("check-no-alpha")) return { status: null, signal: "SIGKILL" }; // killed
    if (file.includes("check-no-beta")) return { status: 1 }; // real violation
    return { status: 0 }; // clean
  };
  const { violations, runnerFailures } = runGuards({ guards, tests, spawn, maxRetries: 0 });

  assert.deepEqual(violations, ["check-no-beta.mjs"]);
  assert.equal(runnerFailures.length, 1);
  assert.match(runnerFailures[0], /check-no-alpha\.mjs/);
  // The killed guard must NOT be reported as a violation.
  assert.ok(!violations.some((v) => v.includes("check-no-alpha")));
});

test("runGuards treats a killed guard SELF-TEST as a runner failure, not a broken guard", () => {
  const guards = ["check-no-alpha.mjs"];
  const tests = new Set(["check-no-alpha.test.mjs"]);
  const spawn = (argv) => (argv.includes("--test") ? { status: null, signal: "SIGKILL" } : { status: 0 });
  const { violations, runnerFailures } = runGuards({ guards, tests, spawn, maxRetries: 0 });
  assert.deepEqual(violations, []);
  assert.equal(runnerFailures.length, 1);
  assert.match(runnerFailures[0], /self-test/);
});

// ── summarizeGuardRun — distinguishable in exit code AND message ─────────────

test("a violation exits 1 and names it a violation", () => {
  const s = summarizeGuardRun({
    guards: ["check-no-a.mjs"],
    tests: new Set(),
    violations: ["check-no-a.mjs"],
    runnerFailures: [],
  });
  assert.equal(s.exitCode, 1);
  assert.ok(s.lines.some((l) => /FAILED \(found violations\)/.test(l)));
});

test("a runner-only failure exits with the distinct runner code and never says 'deterministic'", () => {
  const s = summarizeGuardRun({
    guards: ["check-no-a.mjs"],
    tests: new Set(),
    violations: [],
    runnerFailures: ["check-no-a.mjs — killed by SIGKILL"],
  });
  assert.equal(s.exitCode, RUNNER_FAILURE_EXIT_CODE);
  assert.notEqual(s.exitCode, 1); // distinguishable from a violation by exit code
  assert.ok(s.lines.some((l) => /could not RUN/.test(l)));
  assert.ok(s.lines.some((l) => /not deterministic guard failures/.test(l)));
  // distinguishable from a violation by message
  assert.ok(!s.lines.some((l) => /found violations/.test(l)));
});

test("a clean run exits 0", () => {
  const s = summarizeGuardRun({
    guards: ["check-no-a.mjs", "check-no-b.mjs"],
    tests: new Set(["check-no-a.test.mjs"]),
    violations: [],
    runnerFailures: [],
  });
  assert.equal(s.exitCode, 0);
  assert.ok(s.lines.some((l) => /Guard loop OK/.test(l)));
});

test("a violation and a runner failure together still exit 1 but report both", () => {
  const s = summarizeGuardRun({
    guards: ["check-no-a.mjs", "check-no-b.mjs"],
    tests: new Set(),
    violations: ["check-no-a.mjs"],
    runnerFailures: ["check-no-b.mjs — killed by SIGKILL"],
  });
  assert.equal(s.exitCode, 1); // a real violation dominates
  assert.ok(s.lines.some((l) => /found violations/.test(l)));
  assert.ok(s.lines.some((l) => /could not RUN/.test(l))); // but the runner failure is not lost
});
