import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { acquireInstallStateLock, sha256, updateInstallState } from "./install-state-transaction.mjs";

const fixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-state-transaction-"));
  const statePath = join(dir, "install-state.json");
  await writeFile(statePath, '{"schemaVersion":1,"a":0}\n');
  return { dir, statePath };
};

test("exclusive lock carries interoperable versioned owner metadata", async () => {
  const { statePath } = await fixture();
  const held = await acquireInstallStateLock(statePath, { timeoutMs: 50 });
  const owner = JSON.parse(await readFile(join(`${statePath}.lock`, "owner.json"), "utf8"));
  assert.equal(owner.protocolVersion, 1);
  assert.equal(owner.pid, process.pid);
  assert.match(owner.ownerId, /^[a-f0-9-]+$/);
  await assert.rejects(acquireInstallStateLock(statePath, { timeoutMs: 25 }), /lock_timeout/);
  await held.release();
});

test("expired dead ownership is recovered but an expired live owner is not", async () => {
  const { statePath } = await fixture();
  const lockPath = `${statePath}.lock`;
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ protocolVersion: 1, ownerId: "dead", pid: 99999999, hostname: process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z" }));
  const recovered = await acquireInstallStateLock(statePath, { timeoutMs: 100 });
  await recovered.release();
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner.json"), JSON.stringify({ protocolVersion: 1, ownerId: "live", pid: process.pid, hostname: process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z" }));
  await assert.rejects(acquireInstallStateLock(statePath, { timeoutMs: 25 }), /lock_timeout/);
});

test("release never removes a lock now owned by another live owner", async () => {
  const { statePath } = await fixture();
  const held = await acquireInstallStateLock(statePath);
  const ownerPath = join(held.lockPath, "owner.json");
  await writeFile(ownerPath, JSON.stringify({ ...held.owner, ownerId: "replacement-owner" }));
  await held.release();
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).ownerId, "replacement-owner");
});

test("source byte CAS rejects a changed canonical file", async () => {
  const { statePath } = await fixture();
  const source = await readFile(statePath);
  await writeFile(statePath, '{"schemaVersion":1,"a":2}\n');
  await assert.rejects(updateInstallState(statePath, s => ({ ...s, a: 1 }), { expectedSourceSha256: sha256(source) }), /cas_mismatch/);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).a, 2);
});

test("temp is adjacent, canonical path never disappears, replacement is validated", async () => {
  const { statePath } = await fixture();
  let observedTemp;
  await updateInstallState(statePath, s => ({ ...s, a: 1 }), { onStage: async (stage, context) => {
    if (stage === "temp-flushed") {
      observedTemp = context.tempPath;
      assert.equal(dirname(context.tempPath), dirname(statePath));
      assert.ok(basename(context.tempPath).startsWith(".install-state.json.tmp-"));
      assert.equal(JSON.parse(await readFile(statePath, "utf8")).a, 0);
    }
    if (stage === "replaced") assert.equal(JSON.parse(await readFile(statePath, "utf8")).a, 1);
  }});
  assert.ok(observedTemp);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).a, 1);
});

for (const crashStage of ["locked", "temp-created", "temp-flushed", "replaced", "verified"]) {
  test(`recovery is deterministic after interruption at ${crashStage}`, async () => {
    const { dir, statePath } = await fixture();
    await assert.rejects(updateInstallState(statePath, s => ({ ...s, a: 1 }), { crashAfterStage: crashStage }), /injected_crash/);
    await updateInstallState(statePath, s => ({ ...s, a: 2 }));
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).a, 2);
    assert.deepEqual((await readdir(dir)).filter(n => n.includes(".tmp-") || n.endsWith(".lock")), []);
  });
}
