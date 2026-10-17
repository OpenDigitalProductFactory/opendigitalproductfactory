import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  createAttemptRunner,
  lastCompletedTestLine,
  recoveryReceiptForIdentity,
  resolveVitestMaxDurationMs,
  selectVitestRecoveryPlan,
} from "./local-ci-vitest-runner.mjs";
import { resolveHostCommandInvocation } from "./lib/host-command-invocation.mjs";
import {
  createObservedProcessRunner,
  terminateProcessTree,
} from "./lib/local-ci-process-observer.mjs";
import {
  classifyVitestAttempt,
  runVitestWithRecovery,
} from "./lib/local-ci-vitest-supervisor.mjs";

function manualTimeouts() {
  const scheduled = [];
  return {
    scheduled,
    setTimeoutImpl(callback, delayMs) {
      const timer = { callback, delayMs, cleared: false, ran: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      if (timer) timer.cleared = true;
    },
    runNext(delayMs) {
      const timer = scheduled.find((candidate) => (
        !candidate.cleared && !candidate.ran && candidate.delayMs === delayMs
      ));
      assert.ok(timer, `expected a pending ${delayMs}ms timer`);
      timer.ran = true;
      timer.callback();
      return timer;
    },
  };
}

function fakeChild(pid = 4123) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("Windows observation preserves literal argv and never enables a shell", async () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-observer-pnpm-"));
  writeFileSync(join(root, "pnpm.cmd"), "");
  const script = join(root, "pnpm.cjs");
  writeFileSync(script, "");
  const child = fakeChild();
  let invocation;
  const run = createObservedProcessRunner({
    platform: "win32", sampleHost: () => ({}),
    spawnImpl(command, args, options) { invocation = { command, args, options }; return child; },
    stdout: { write() {} }, stderr: { write() {} },
  });
  try {
    const args = ["exec", "%PATH%", "a&b", ""];
    const pending = run({ command: "pnpm", args, env: { PATH: root }, shell: true });
    child.emit("close", 0, null);
    assert.equal((await pending).status, 0);
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(invocation.args, [script, ...args]);
    assert.equal(invocation.options.shell, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("observer cancellation stops the owned tree and cannot turn a late zero exit into success", async () => {
  const child = fakeChild();
  const controller = new AbortController();
  const stopped = [];
  let options;
  const run = createObservedProcessRunner({ spawnImpl: (_command, _args, input) => { options = input; return child; },
    sampleHost: () => ({}), stdout: { write() {} }, stderr: { write() {} },
    maxDurationMs: 10000, terminateProcessTreeImpl: (pid, input) => { stopped.push({ pid, ...input }); return { ok: true }; } });
  const pending = run({ command: "fixture", args: [], cwd: "/fixture", shell: false, signal: controller.signal });
  controller.abort();
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.deadlineExceeded, false);
  assert.equal(options.cwd, "/fixture");
  assert.equal(options.shell, false);
  assert.deepEqual(stopped, [{ pid: child.pid, force: false }]);
});

test("an already cancelled observer never starts a child", async () => {
  const controller = new AbortController();
  controller.abort();
  const run = createObservedProcessRunner({ spawnImpl: () => { throw new Error("must not spawn"); } });
  const result = await run({ command: "fixture", args: [], signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(result.childPid, null);
});

test("failed progress recording is retained as an execution limitation rather than a zero-exit pass", async () => {
  const child = fakeChild();
  const run = createObservedProcessRunner({ spawnImpl: () => child, sampleHost: () => ({}),
    stdout: { write() {} }, stderr: { write() {} }, onProgress: () => { throw new Error("receipt unavailable"); } });
  const pending = run({ command:"fixture",args:[] });
  child.emit("close",0,null);
  const result = await pending;
  assert.equal(result.error.message,"receipt unavailable");
});

test("progress continues after the retained host sample window fills", async () => {
  const child = fakeChild();
  let sample, observations = 0;
  const run = createObservedProcessRunner({ spawnImpl: () => child, sampleHost: () => ({}),
    stdout: {write() {}},stderr: {write() {}},onProgress: () => observations++,
    setIntervalImpl: callback => {sample=callback;return {unref() {}};},clearIntervalImpl: () => {} });
  const pending = run({command:"fixture",args:[]});
  for(let i=0;i<125;i++) sample();
  child.emit("close",0,null);
  const result=await pending;
  assert.equal(result.hostSamples.length,120,"history remains bounded");
  assert.equal(observations,127,"start, all heartbeats and completion remain observable");
});

test("a delayed deadline callback cannot make an over-budget zero exit successful", async () => {
  const child=fakeChild(),timers=manualTimeouts();
  let clock=0;
  const run=createObservedProcessRunner({spawnImpl:()=>child,sampleHost:()=>({}),
    stdout:{write(){}},stderr:{write(){}},maxDurationMs:100,
    now:()=>new Date(clock).toISOString(),setTimeoutImpl:timers.setTimeoutImpl,clearTimeoutImpl:timers.clearTimeoutImpl});
  const pending=run({command:"fixture",args:[]});
  clock=101;
  child.emit("close",0,null);
  const result=await pending;
  assert.equal(result.deadlineExceeded,true,"elapsed budget is authoritative even before timer delivery");
});

test("Vitest stage duration defaults to 30 minutes and accepts only a positive override", () => {
  assert.equal(resolveVitestMaxDurationMs({}), 1_800_000);
  assert.equal(resolveVitestMaxDurationMs({ DPF_LOCAL_CI_VITEST_MAX_DURATION_MS: "45000" }), 45_000);
  assert.equal(resolveVitestMaxDurationMs({ DPF_LOCAL_CI_VITEST_MAX_DURATION_MS: "0" }), 1_800_000);
  assert.equal(resolveVitestMaxDurationMs({ DPF_LOCAL_CI_VITEST_MAX_DURATION_MS: "invalid" }), 1_800_000);
});

test("the bounded observer stops then force-stops a hung process tree and closes with terminal evidence", async () => {
  const child = fakeChild();
  const timers = manualTimeouts();
  const terminations = [];
  let clock = 0;
  const runObserved = createObservedProcessRunner({
    spawnImpl: () => child,
    sampleHost: () => ({ freeMemoryBytes: 24_000_000_000 }),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
    maxDurationMs: 1_800_000,
    terminationGraceMs: 10_000,
    closeGraceMs: 10_000,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    now: () => new Date(clock).toISOString(),
    terminateProcessTreeImpl: (pid, options) => {
      terminations.push({ pid, ...options });
      return { ok: true, force: options.force };
    },
  });

  const resultPromise = runObserved({ command: "pnpm", args: ["vitest"] });
  clock = 1_800_000;
  timers.runNext(1_800_000);
  assert.deepEqual(terminations, [{ pid: 4123, force: false }]);
  clock += 10_000;
  timers.runNext(10_000);
  assert.deepEqual(terminations, [
    { pid: 4123, force: false },
    { pid: 4123, force: true },
  ]);
  clock += 10_000;
  timers.runNext(10_000);

  const result = await resultPromise;
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.maxDurationMs, 1_800_000);
  assert.equal(result.deadlineAt, new Date(1_800_000).toISOString());
  assert.equal(result.stopAttemptedAt, new Date(1_800_000).toISOString());
  assert.equal(result.forceAttemptedAt, new Date(1_810_000).toISOString());
  assert.equal(result.closeTimedOutAt, new Date(1_820_000).toISOString());
  assert.equal(result.closeTimedOut, true);
  assert.equal(result.status, null);
  assert.equal(result.childPid, 4123);
  assert.ok(result.hostSamples.length >= 3, "start, deadline, and terminal samples are retained");
  assert.equal(classifyVitestAttempt(result), "runner-termination");
});

test("a late zero exit after the deadline is runner termination and receives one reduced-worker retry", async () => {
  const child = fakeChild(5001);
  const timers = manualTimeouts();
  const runObserved = createObservedProcessRunner({
    spawnImpl: () => child,
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
    maxDurationMs: 100,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    terminateProcessTreeImpl: () => ({ ok: true }),
  });
  const firstPromise = runObserved({ command: "pnpm", args: ["vitest"] });
  timers.runNext(100);
  child.emit("close", 0, null);
  const lateZero = await firstPromise;

  const workers = [];
  const recovered = await runVitestWithRecovery({
    runAttempt: async ({ attempt, workers: attemptWorkers }) => {
      workers.push(attemptWorkers);
      return attempt === 1
        ? lateZero
        : { status: 0, signal: null, error: null, outputTail: "Tests  20000 passed" };
    },
  });
  assert.equal(lateZero.deadlineExceeded, true);
  assert.equal(classifyVitestAttempt(lateZero), "runner-termination");
  assert.deepEqual(workers, [4, 2]);
  assert.equal(recovered.status, 0);
  assert.equal(recovered.recovered, true);
});

test("termination helper errors remain bounded and are preserved in the terminal receipt", async () => {
  const child = fakeChild(5501);
  const timers = manualTimeouts();
  const runObserved = createObservedProcessRunner({
    spawnImpl: () => child,
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
    maxDurationMs: 100,
    terminationGraceMs: 10,
    closeGraceMs: 10,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    terminateProcessTreeImpl: (_pid, { force }) => {
      throw Object.assign(new Error(force ? "force failed" : "stop failed"), {
        code: force ? "EFORCE" : "ESTOP",
      });
    },
  });
  const resultPromise = runObserved({ command: "pnpm", args: ["vitest"] });
  timers.runNext(100);
  timers.runNext(10);
  timers.runNext(10);

  const result = await resultPromise;
  assert.equal(result.deadlineExceeded, true);
  assert.equal(result.closeTimedOut, true);
  assert.deepEqual(result.stopResult, {
    ok: false,
    force: false,
    error: { name: "Error", code: "ESTOP", message: "stop failed" },
  });
  assert.deepEqual(result.forceResult, {
    ok: false,
    force: true,
    error: { name: "Error", code: "EFORCE", message: "force failed" },
  });
  assert.equal(classifyVitestAttempt(result), "runner-termination");
});

test("a normal close clears the deadline and observers without a bound remain unbounded", async () => {
  const boundedChild = fakeChild(6001);
  const boundedTimers = manualTimeouts();
  const boundedRun = createObservedProcessRunner({
    spawnImpl: () => boundedChild,
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
    maxDurationMs: 100,
    setTimeoutImpl: boundedTimers.setTimeoutImpl,
    clearTimeoutImpl: boundedTimers.clearTimeoutImpl,
  });
  const boundedPromise = boundedRun({ command: "pnpm", args: ["vitest"] });
  boundedChild.emit("close", 0, null);
  const bounded = await boundedPromise;
  assert.equal(bounded.deadlineExceeded, false);
  assert.equal(boundedTimers.scheduled[0].cleared, true);

  const unboundedChild = fakeChild(6002);
  const unboundedTimers = manualTimeouts();
  const unboundedRun = createObservedProcessRunner({
    spawnImpl: () => unboundedChild,
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
    setTimeoutImpl: unboundedTimers.setTimeoutImpl,
    clearTimeoutImpl: unboundedTimers.clearTimeoutImpl,
  });
  const unboundedPromise = unboundedRun({ command: "pnpm", args: ["typecheck"] });
  assert.equal(unboundedTimers.scheduled.length, 0);
  unboundedChild.emit("close", 0, null);
  assert.equal((await unboundedPromise).maxDurationMs, null);
});

test("only a bounded POSIX observer starts the child in an isolated process group", async () => {
  const boundedChild = fakeChild(6501);
  const unboundedChild = fakeChild(6502);
  const spawnOptions = [];
  const boundedRun = createObservedProcessRunner({
    platform: "linux",
    maxDurationMs: 100,
    spawnImpl: (_command, _args, options) => {
      spawnOptions.push(options);
      return boundedChild;
    },
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
  });
  const unboundedRun = createObservedProcessRunner({
    platform: "linux",
    spawnImpl: (_command, _args, options) => {
      spawnOptions.push(options);
      return unboundedChild;
    },
    sampleHost: () => ({}),
    stdout: { write() {} },
    stderr: { write() {} },
    sampleIntervalMs: 60_000,
  });
  const boundedPromise = boundedRun({ command: "pnpm", args: ["vitest"] });
  const unboundedPromise = unboundedRun({ command: "pnpm", args: ["typecheck"] });
  boundedChild.emit("close", 0, null);
  unboundedChild.emit("close", 0, null);
  await Promise.all([boundedPromise, unboundedPromise]);

  assert.equal(spawnOptions[0].shell, false);
  assert.equal(spawnOptions[0].detached, true);
  assert.equal(spawnOptions[1].shell, false);
  assert.equal(spawnOptions[1].detached, false);
});

test("process-tree termination preserves platform-specific graceful and force semantics", () => {
  const windowsCalls = [];
  const winSpawn = (command, args) => {
    windowsCalls.push({ command, args });
    return { status: 0, signal: null, error: null };
  };
  terminateProcessTree(7001, { platform: "win32", force: false, spawnSyncImpl: winSpawn });
  terminateProcessTree(7001, { platform: "win32", force: true, spawnSyncImpl: winSpawn });
  assert.deepEqual(windowsCalls, [
    { command: "taskkill.exe", args: ["/PID", "7001", "/T"] },
    { command: "taskkill.exe", args: ["/PID", "7001", "/T", "/F"] },
  ]);

  const posixCalls = [];
  terminateProcessTree(7001, {
    platform: "linux",
    force: false,
    killImpl: (pid, signal) => posixCalls.push({ pid, signal }),
  });
  terminateProcessTree(7001, {
    platform: "linux",
    force: true,
    killImpl: (pid, signal) => posixCalls.push({ pid, signal }),
  });
  assert.deepEqual(posixCalls, [
    { pid: -7001, signal: "SIGTERM" },
    { pid: -7001, signal: "SIGKILL" },
  ]);
});

test("lastCompletedTestLine returns the latest verbose Vitest test marker", () => {
  assert.equal(lastCompletedTestLine([
    "stdout before tests",
    " ✓ lib/first.test.ts > first",
    " ✓ lib/last.test.ts > last",
  ].join("\n")), "✓ lib/last.test.ts > last");
});

test("a prior externally terminated receipt resumes at the differentiated worker count", () => {
  assert.deepEqual(selectVitestRecoveryPlan({
    priorDisposition: "externally-terminated",
    priorExecutionProfile: { mode: "initial", workers: 4 },
    initialWorkers: 4,
    retryWorkers: 2,
  }), {
    initialWorkers: 2,
    retryWorkers: 2,
    allowRetry: false,
    recoveringPriorTermination: true,
    exhausted: false,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  });
  assert.equal(selectVitestRecoveryPlan({
    priorDisposition: "terminal-or-absent",
    initialWorkers: 4,
    retryWorkers: 2,
  }).initialWorkers, 4);
});

test("a vanished differentiated receipt exhausts recovery before another child starts", () => {
  assert.deepEqual(selectVitestRecoveryPlan({
    priorDisposition: "externally-terminated",
    priorExecutionProfile: { mode: "differentiated-recovery", workers: 2 },
    initialWorkers: 4,
    retryWorkers: 2,
  }), {
    initialWorkers: 2,
    retryWorkers: 2,
    allowRetry: false,
    recoveringPriorTermination: true,
    exhausted: true,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  });
  assert.equal(selectVitestRecoveryPlan({
    priorDisposition: "retry-exhausted",
    priorExecutionProfile: { mode: "differentiated-recovery", workers: 2 },
    initialWorkers: 4,
    retryWorkers: 2,
  }).exhausted, true);
});

test("a changed integration identity starts a fresh recovery budget", () => {
  const receipt = {
    stage: "exhaustive-vitest",
    status: "running",
    identity: { integrationTreeSha: "old-tree", command: "vitest" },
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  };

  assert.equal(recoveryReceiptForIdentity({
    receipt,
    identity: { integrationTreeSha: "new-tree", command: "vitest" },
  }), null);
  assert.equal(recoveryReceiptForIdentity({
    receipt,
    identity: receipt.identity,
  }), receipt);
});

test("the executable runner refuses a persisted exhausted profile before spawn", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-vitest-exhausted-"));
  const metadataPath = join(temp, "metadata.json");
  const diagnosticsPath = `${metadataPath}.vitest.json`;
  const integrationTreeSha = execFileSync(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  writeFileSync(diagnosticsPath, `${JSON.stringify({
    schemaVersion: 1,
    stage: "exhaustive-vitest",
    identity: {
      integrationTreeSha,
      command: "pnpm --filter web exec vitest run --maxWorkers=4 --reporter=verbose",
      maxDurationMs: 1_800_000,
    },
    status: "runner-termination",
    retryExhausted: true,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
    hostPid: 999_999,
    lastHeartbeatAt: "2026-08-08T00:00:00.000Z",
    observations: [],
  })}\n`);

  try {
    const result = spawnSync(process.execPath, [
      "scripts/local-ci-vitest-runner.mjs",
      "--initial-workers", "4",
      "--retry-workers", "2",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DPF_LOCAL_CI_METADATA_FILE: metadataPath },
    });
    assert.equal(result.status, 86, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /without another child/);
    assert.equal(JSON.parse(readFileSync(diagnosticsPath, "utf8")).retryExhausted, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("attempt runner streams output and retains progress plus host evidence on opaque exit", async () => {
  const child = new EventEmitter();
  child.pid = 4123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const streamed = { stdout: "", stderr: "" };
  let invocation = null;
  const runAttempt = createAttemptRunner({
    spawnImpl(command, args) {
      invocation = { command, args };
      queueMicrotask(() => {
        child.stdout.write(" ✓ apps/web/last.test.ts > completes\n");
        child.stderr.write("worker closed without summary\n");
        child.emit("close", -1, null);
      });
      return child;
    },
    sampleHost: (pid) => ({ pid, freeMemoryBytes: 24_000_000_000 }),
    stdout: { write: (chunk) => { streamed.stdout += String(chunk); } },
    stderr: { write: (chunk) => { streamed.stderr += String(chunk); } },
    sampleIntervalMs: 60_000,
  });

  const result = await runAttempt({ workers: 4, attempt: 1 });

  assert.equal(invocation.command, resolveHostCommandInvocation("pnpm", []).command);
  assert.ok(invocation.args.includes("--maxWorkers=4"));
  assert.ok(invocation.args.includes("--reporter=verbose"));
  assert.match(streamed.stdout, /last\.test\.ts/);
  assert.match(streamed.stderr, /without summary/);
  assert.equal(result.status, -1);
  assert.equal(result.lastCompletedTest, "✓ apps/web/last.test.ts > completes");
  assert.ok(result.hostSamples.length >= 2);
  assert.equal(result.hostSamples[0].pid, 4123);
});
