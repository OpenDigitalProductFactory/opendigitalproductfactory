import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./rotate-runtime-transition-secret.mjs", import.meta.url)).replace(/^\/(.:\/)/, "$1");
const run = (stateDir, ...args) => spawnSync(process.execPath, [script, "--state-dir", stateDir, ...args], { encoding: "utf8" });

test("creates a cryptographically random owner-only secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  const result = run(dir, "--initialize");
  assert.equal(result.status, 0, result.stderr);
  assert.match((await readFile(join(dir, "runtime-transition.secret"), "utf8")).trim(), /^[a-f0-9]{64}$/);
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "runtime-transition.secret"))).mode & 0o777, 0o600);
});

test("rotation fails closed while a transition claim is active", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  const transitions = join(dir, "runtime-capability-transitions");
  await mkdir(join(transitions, "RCT-live.json.claim"), { recursive: true });
  const before = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
  assert.equal(await readFile(join(dir, "runtime-transition.secret"), "utf8"), before);
});

test("rotation fails closed while the host apply lock is held", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  await mkdir(join(dir, ".runtime-transition-apply.lock"));
  await writeFile(join(dir, ".runtime-transition-apply.lock", "expires-at"), new Date(Date.now() + 60_000).toISOString());
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
});

test("rotation fails closed while durable transition authority is reserved before DB pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  await writeFile(join(dir, "runtime-transition-authority.json"), JSON.stringify({ transitionId: "RCT-before-db" }));
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75);
  assert.match(result.stderr, /transition_in_progress/);
});

test("rotation archives the old key with its receipts and installs a new key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-"));
  assert.equal(run(dir, "--initialize").status, 0);
  const old = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  const transitions = join(dir, "runtime-capability-transitions");
  await mkdir(transitions);
  await writeFile(join(transitions, "RCT-done.json"), "{}\n");
  const result = run(dir, "--rotate");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const next = await readFile(join(dir, "runtime-transition.secret"), "utf8");
  assert.notEqual(next, old);
  assert.equal(await readFile(join(output.archiveDir, "runtime-transition.secret"), "utf8"), old);
  assert.equal(await readFile(join(output.archiveDir, "runtime-capability-transitions", "RCT-done.json"), "utf8"), "{}\n");
});


test("expired apply timestamp cannot permit key rotation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(run(dir, "--initialize").status, 0);
  const before = await readFile(join(dir, "runtime-transition.secret"));
  const lock = join(dir, ".runtime-transition-apply.lock");
  await mkdir(lock);
  const expired = new Date(Date.now() - 60_000).toISOString();
  await writeFile(join(lock, "expires-at"), expired);
  const result = run(dir, "--rotate");
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /transition_in_progress/);
  assert.equal(await readFile(join(lock, "expires-at"), "utf8"), expired);
  assert.deepEqual(await readFile(join(dir, "runtime-transition.secret")), before);
});

// Pause at an actual key-write boundary after all legacy preflight checks.
// This test hook lives only in the child preload; production has no pause flag.
for (const outcome of ["finish", "kill"]) test(`rotation holds the shared apply boundary through ${outcome}`, { skip: process.platform === "win32", timeout: 15000 }, async t => {
  const { once } = await import("node:events");
  const { acquireRuntimeApplyLock } = await import("./installer/runtime-apply-lock.mjs");
  const dir = await mkdtemp(join(tmpdir(), "dpf-rotate-overlap-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(run(dir, "--initialize").status, 0);
  const before = await readFile(join(dir, "runtime-transition.secret"));
  const hook = join(dir, "pause.mjs");
  await writeFile(hook, `
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { once } from "node:events";
    const write = fs.writeFile;
    fs.writeFile = async (path, ...args) => {
      if (String(path).includes(".runtime-transition.secret.") && String(path).endsWith(".tmp")) {
        const resume = once(process, "message");
        process.send("paused");
        await resume;
      }
      return write(path, ...args);
    };
    syncBuiltinESMExports();
  `);
  const child = spawn(process.execPath, ["--import", hook, script, "--state-dir", dir, "--rotate"], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const exited = once(child, "exit");
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; });
  assert.equal((await once(child, "message"))[0], "paused");
  assert.deepEqual(await readFile(join(dir, "runtime-transition.secret")), before);
  let competitor;
  try {
    await assert.rejects(async () => { competitor = await acquireRuntimeApplyLock({ stateDirectory: dir, runId: "competing-runtime" }); }, /runtime_apply_lock_contended/);
  } finally { await competitor?.release(); }
  const owner = JSON.parse(await readFile(join(dir, ".runtime-transition-apply.lock", "owner.json"), "utf8"));
  assert.equal(owner.pid, child.pid);
  assert.equal(owner.protocolVersion, 2);
  if (outcome === "kill") {
    child.kill("SIGKILL");
    assert.equal((await exited)[1], "SIGKILL");
    assert.deepEqual(await readFile(join(dir, "runtime-transition.secret")), before);
    assert.deepEqual(JSON.parse(await readFile(join(dir, ".runtime-transition-apply.lock", "owner.json"), "utf8")), owner);
    await assert.rejects(acquireRuntimeApplyLock({ stateDirectory: dir, runId: "after-killed-rotation" }), /runtime_apply_lock_contended/);
    return;
  }
  child.send("resume");
  const [code] = await exited;
  assert.equal(code, 0, stderr);
  assert.notDeepEqual(await readFile(join(dir, "runtime-transition.secret")), before);
  const next = await acquireRuntimeApplyLock({ stateDirectory: dir, runId: "after-rotation" });
  await next.release();
});
