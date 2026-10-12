import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProcessTreeTracker, readProcessRows, terminatePid, parsePosixProcessRows } from "./gate-worktree.mjs";

const row = (pid, parentPid, birthTime) => ({ pid, parentPid, birthTime, commandLine: "node worker.mjs" });

test("Windows parent-pipe loss fences only its job before execution completion", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-job-loss-"));
  const marker = join(directory, "writes.log");
  const script = "const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(process.env.TEST_MARKER,'x'),50);";
  const child = spawn("powershell.exe", ["-NoProfile", "-File", resolve("scripts/lib/run-in-windows-job.ps1")], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TEST_MARKER: marker,
      DPF_WINDOWS_JOB_COMMAND: JSON.stringify({ kind: "argv", value: [process.execPath, "-e", script] }),
      DPF_GATE_EXECUTION_CONTEXT: "" },
  });
  const closed = once(child, "close");
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 12_000;
    while (!existsSync(marker) && Date.now() < deadline && child.exitCode === null) await delay(50);
    assert.equal(existsSync(marker), true, output);
    child.stdin.end(); // Simulates the supervisor disappearing, without killing any unrelated PID.
    const [code] = await closed;
    assert.equal(code, 75, output);
    const bytes = readFileSync(marker, "utf8");
    await delay(250);
    assert.equal(readFileSync(marker, "utf8"), bytes);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
test("Linux process observations reuse the fence's kernel start-tick identity", () => {
  const rows = parsePosixProcessRows(" 200 100 Sun Sep 27 12:00:00 2026 node worker", {
    platform: "linux", identityForPid: (pid) => pid === 200 ? "linux:123456789" : "",
  });
  assert.equal(rows[0].birthTime, "123456789");
});
function fixture(initial) {
  let rows = initial;
  let time = 0;
  const terminated = [];
  const tracker = createProcessTreeTracker({
    rootPid: 100,
    supervisorPid: 90,
    listProcessRows: () => rows,
    processAlive: () => true,
    terminate: (pid) => terminated.push(pid),
    wait: async (ms) => { time += ms; },
    now: () => time,
  });
  tracker.sample();
  return { tracker, terminated, replace: (next) => { rows = next; } };
}

test("same command line does not authorize a reused descendant PID", async () => {
  const f = fixture([row(100, 90, "1000"), row(200, 100, "2000")]);
  f.replace([row(200, 1, "3000")]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
  assert.equal(f.tracker.cleanupUncertain(), false);
});

test("an unavailable process listing never authorizes cleanup", async () => {
  const f = fixture([row(100, 90, "1000"), row(200, 100, "2000")]);
  f.replace([]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
  assert.equal(f.tracker.cleanupUncertain(), true);
});

test("a missing birth identity never authorizes cleanup", async () => {
  const f = fixture([row(100, 90, "1000"), row(200, 100, undefined)]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
  assert.equal(f.tracker.cleanupUncertain(), true);
});

test("a remembered descendant with unreadable birth is unknown, not proven PID reuse", async () => {
  const f = fixture([row(100, 90, "1000"), row(200, 100, "2000")]);
  f.replace([row(200, 1, undefined)]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
  assert.equal(f.tracker.cleanupUncertain(), true);
});

test("an initially unreadable process snapshot cannot establish clean completion", async () => {
  const f = fixture([]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
  assert.equal(f.tracker.cleanupUncertain(), true);
});

test("a rejected asynchronous scan retains uncertainty without authorizing a kill", async () => {
  const tracker = createProcessTreeTracker({ rootPid: 100, listProcessRowsAsync: async () => { throw new Error('unreadable'); } });
  await assert.rejects(tracker.sampleAsync(), /unreadable/);
  assert.equal(tracker.cleanupUncertain(), true);
  assert.deepEqual(tracker.rememberedPids(), []);
});

test("invalid birth values and sub-number-precision impossible parentage are excluded", async () => {
  for (const birth of ["NaN", "-1", "0", "63894636800123456"]) {
    const f = fixture([row(100, 90, "63894636800123457"), row(200, 100, birth)]);
    await f.tracker.waitForQuiescence({ graceMs: 0 });
    assert.deepEqual(f.terminated, []);
  }
});

test("stale parent links cannot include the supervisor or its ancestors", async () => {
  const f = fixture([row(100, 90, "1000"), row(90, 80, "500"), row(80, 100, "100")]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
});

test("children of a reused root are never adopted into the old command", async () => {
  const f = fixture([row(100, 90, "1000")]);
  f.replace([row(100, 90, "3000"), row(200, 100, "4000")]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, []);
});

test("a remembered descendant with matching birth identity is cleaned after reparenting", async () => {
  const f = fixture([row(100, 90, "1000"), row(200, 100, "2000")]);
  f.replace([row(200, 1, "2000")]);
  await f.tracker.waitForQuiescence({ graceMs: 0 });
  assert.deepEqual(f.terminated, [200]);
});

test("a late asynchronous observation cannot replace a newer cleanup snapshot", async () => {
  let finish;
  const rows = [row(100, 90, "1000"), row(200, 100, "2000")];
  const tracker = createProcessTreeTracker({
    rootPid: 100,
    listProcessRows: () => [],
    listProcessRowsAsync: () => new Promise((resolve) => { finish = resolve; }),
    processAlive: () => true,
  });
  const pending = tracker.sampleAsync();
  tracker.sample();
  finish(rows);
  await pending;
  assert.deepEqual(tracker.liveRememberedDescendants(), []);
});

test("Windows cleanup binds the owned process handle and refuses a mismatched birth", {
  skip: process.platform !== "win32", timeout: 30000,
}, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const exited = once(child, "exit");
  try {
    const identity = readProcessRows().find((entry) => entry.pid === child.pid);
    assert.ok(identity?.birthTime, "CIM must supply birth identity for the owned child");
    terminatePid(child.pid, { ...identity, birthTime: "1" });
    assert.doesNotThrow(() => process.kill(child.pid, 0));
    terminatePid(child.pid, identity);
    await exited;
  } finally {
    child.kill();
  }
});
