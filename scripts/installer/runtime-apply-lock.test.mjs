import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { acquireRuntimeApplyLock } from "./runtime-apply-lock.mjs";

const posix = { skip: process.platform === "win32" };
async function fixture(t) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "dpf-apply-lock-"));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  return { stateDirectory, path: join(stateDirectory, ".runtime-transition-apply.lock"), runId: "OR-test" };
}
test("exclusive apply ownership binds token, process start and host", posix, async t => {
  const f = await fixture(t); const lease = await acquireRuntimeApplyLock(f);
  const owner = JSON.parse(await readFile(join(f.path, "owner.json"), "utf8"));
  assert.equal(owner.protocolVersion, 2);
  assert.equal(owner.pid, process.pid);
  assert.ok(owner.host && owner.processIdentity && owner.token);
  assert.equal(owner.runId, f.runId);
  await assert.rejects(acquireRuntimeApplyLock(f), /runtime_apply_lock_contended/);
  assert.equal(await lease.release(), true);
  assert.equal(await lease.release(), false);
  const next = await acquireRuntimeApplyLock(f);
  assert.notEqual(next.owner.token, owner.token);
  await next.release();
});
test("expired legacy ownership is preserved without settlement evidence", posix, async t => {
  const f = await fixture(t); await mkdir(f.path);
  const expired = new Date(Date.now() - 60000).toISOString();
  await writeFile(join(f.path, "expires-at"), expired);
  await assert.rejects(acquireRuntimeApplyLock(f), /runtime_apply_lock_contended/);
  assert.equal(await readFile(join(f.path, "expires-at"), "utf8"), expired);
});
test("release refuses ownership changed to another generation", posix, async t => {
  const f = await fixture(t); const lease = await acquireRuntimeApplyLock(f);
  const replacement = { ...lease.owner, token: "replacement" };
  await writeFile(join(f.path, "owner.json"), JSON.stringify(replacement));
  assert.equal(await lease.release(), false);
  assert.deepEqual(JSON.parse(await readFile(join(f.path, "owner.json"))), replacement);
});
test("a separately executing contender cannot acquire the held boundary", posix, async t => {
  const f = await fixture(t); const lease = await acquireRuntimeApplyLock(f);
  const moduleUrl = new URL("./runtime-apply-lock.mjs", import.meta.url).href;
  const code = `import { acquireRuntimeApplyLock } from ${JSON.stringify(moduleUrl)}; try { await acquireRuntimeApplyLock(${JSON.stringify(f)}); process.exitCode=9; } catch(e) { if(e.message !== 'runtime_apply_lock_contended') throw e; }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
  let error = ""; child.stderr.on("data", data => error += data);
  const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(status, 0, error);
  assert.equal(await lease.release(), true);
});

test("dead executor alone does not authorize reclaiming potentially unsettled effects", posix, async t => {
  const f = await fixture(t);
  const moduleUrl = new URL("./runtime-apply-lock.mjs", import.meta.url).href;
  const code = `import { acquireRuntimeApplyLock } from ${JSON.stringify(moduleUrl)}; const lease=await acquireRuntimeApplyLock(${JSON.stringify(f)}); process.send(lease.owner); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const owner = await new Promise((resolve, reject) => { child.once("message", resolve); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited before ownership: ${code}`))); });
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGKILL"); await exited;
  await assert.rejects(acquireRuntimeApplyLock(f), /runtime_apply_lock_contended/);
  assert.deepEqual(JSON.parse(await readFile(join(f.path, "owner.json"))), owner);
});
test("a lost directory generation invalidates the held capability", posix, async t => {
  const f = await fixture(t); const lease = await acquireRuntimeApplyLock(f);
  await lease.assertOwned();
  await rm(f.path, { recursive: true }); await mkdir(f.path, { mode: 0o700 });
  await writeFile(join(f.path, "owner.json"), "replacement", { mode: 0o600 });
  await assert.rejects(lease.assertOwned(), /runtime_apply_lock_not_owned/);
  assert.equal(await lease.release(), false);
  assert.equal(await readFile(join(f.path, "owner.json"), "utf8"), "replacement");
});
