import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { acquireInstallStateLock, restoreInstallState, sha256, updateInstallState } from "./install-state-transaction.mjs";

const fixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-state-transaction-"));
  const statePath = join(dir, "install-state.json");
  await writeFile(statePath, '{"schemaVersion":2,"installerVersion":"test","platform":"linux","arch":"amd64","enabledRuntimeCapabilities":["runtime:core"],"capabilityCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","capabilityStateVersion":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n');
  return { dir, statePath };
};

test("exclusive lock carries interoperable versioned owner metadata", async () => {
  const { statePath } = await fixture();
  const held = await acquireInstallStateLock(statePath, { timeoutMs: 50 });
  const owner = JSON.parse(await readFile(`${statePath}.lock`, "utf8"));
  assert.equal(owner.protocolVersion, 1);
  assert.equal(owner.pid, process.pid);
  assert.match(owner.runId, /^[a-f0-9-]+$/);
  assert.match(owner.ownerId, /^[a-f0-9-]+$/);
  await assert.rejects(acquireInstallStateLock(statePath, { timeoutMs: 25 }), /lock_timeout/);
  await held.release();
});

test("every write validates schema and leaves a flushed deterministic recovery copy before replacement", async () => {
  const { statePath } = await fixture();
  const recoveryPath = join(dirname(statePath), "governed-recovery.json");
  await assert.rejects(updateInstallState(statePath, state => ({ ...state, schemaVersion: 99 }), { recoveryPath }), /schema_validation/);
  await updateInstallState(statePath, state => ({ ...state, installerVersion: "next" }), { recoveryPath });
  assert.equal(JSON.parse(await readFile(recoveryPath, "utf8")).installerVersion, "test");
});

test("reconciliation restores recovery when an interrupted canonical file is invalid", async () => {
  const { statePath } = await fixture();
  const recoveryPath = join(dirname(statePath), "governed-recovery.json");
  const validBytes = await readFile(statePath);
  await writeFile(recoveryPath, validBytes);
  await writeFile(statePath, '{"schemaVersion":2');
  await updateInstallState(statePath, state => ({ ...state, installerVersion: "restored-next" }), { recoveryPath });
  assert.equal(JSON.parse(await readFile(recoveryPath, "utf8")).installerVersion, "test");
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "restored-next");
});

test("expired dead ownership is recovered but an expired live owner is not", async () => {
  const { statePath } = await fixture();
  const lockPath = `${statePath}.lock`;
  await writeFile(lockPath, JSON.stringify({ protocolVersion: 1, ownerId: "dead", pid: 99999999, hostname: process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z", expiresAtEpoch: 946684801 }));
  const recovered = await acquireInstallStateLock(statePath, { timeoutMs: 100 });
  assert.ok((await readdir(dirname(lockPath))).includes(`${basename(lockPath)}.reclaim-${sha256("dead").slice(0, 24)}`));
  await recovered.release();
  await writeFile(lockPath, JSON.stringify({ protocolVersion: 1, ownerId: "live", pid: process.pid, hostname: process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z", expiresAtEpoch: 946684801 }));
  await assert.rejects(acquireInstallStateLock(statePath, { timeoutMs: 25 }), /lock_timeout/);
});

test("two stale reclaimers cannot ABA-remove a fresh live claim", { timeout: 1000 }, async () => {
  const { statePath } = await fixture(); const lockPath = `${statePath}.lock`;
  await writeFile(lockPath, JSON.stringify({ protocolVersion: 1, ownerId: "dead", runId: "dead-run", pid: 99999999, hostname: "foreign", acquiredAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-01T00:00:01Z", expiresAtEpoch: 946684801 }));
  let observed; const staleObserved = new Promise(resolve => { observed = resolve; });
  let resume; const paused = new Promise(resolve => { resume = resolve; });
  const first = acquireInstallStateLock(statePath, { timeoutMs: 150, onStaleObserved: async () => { observed(); await paused; } });
  await staleObserved;
  const fresh = await acquireInstallStateLock(statePath, { timeoutMs: 150 });
  resume();
  await assert.rejects(first, /lock_timeout/);
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).ownerId, fresh.owner.ownerId);
  await fresh.release();
});

test("late lower-sorted nomination cannot join after reclaim election closes", { timeout: 1000 }, async () => {
  const { statePath } = await fixture(); const lockPath = `${statePath}.lock`;
  await writeFile(lockPath, JSON.stringify({ protocolVersion: 1, ownerId: "stale-generation", runId: "dead", pid: 99999999, hostname: "foreign", acquiredAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-01T00:00:01Z", expiresAtEpoch: 946684801 }));
  let elected; const electionClosed = new Promise(resolve => { elected = resolve; }); let resume; const paused = new Promise(resolve => { resume = resolve; });
  const first = acquireInstallStateLock(statePath, { timeoutMs: 500, reclaimOwnerId: "z-winner", onReclaimElected: async () => { elected(); await paused; } });
  await electionClosed;
  const second = acquireInstallStateLock(statePath, { timeoutMs: 150, reclaimOwnerId: "a-late" });
  await assert.rejects(second, /lock_timeout/);
  resume(); const acquired = await first; await acquired.release();
});

test("generation guard never renames a different stale generation", { timeout: 1000 }, async () => {
  const { statePath } = await fixture(); const lockPath = `${statePath}.lock`; const stale = ownerId => ({ protocolVersion: 1, ownerId, runId: "dead", pid: 99999999, hostname: "foreign", acquiredAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-01T00:00:01Z", expiresAtEpoch: 946684801 });
  await writeFile(lockPath, JSON.stringify(stale("generation-a")));
  let elected; const closed = new Promise(resolve => { elected = resolve; }); let resume; const paused = new Promise(resolve => { resume = resolve; }); let mismatchOwner;
  const pending = acquireInstallStateLock(statePath, { timeoutMs: 500, onReclaimElected: async () => { elected(); await paused; }, onGenerationMismatch: owner => { mismatchOwner = owner; } });
  await closed; await writeFile(lockPath, JSON.stringify(stale("generation-b"))); resume();
  const acquired = await pending;
  assert.equal(mismatchOwner, "generation-b");
  await acquired.release();
});

test("two expired-guard cleaners cannot rename a fresh owner", { timeout: 1000 }, async () => {
  const { statePath } = await fixture(); const lockPath = `${statePath}.lock`; const guardPath = `${lockPath}.reclaim-deadguard`;
  const owner = (ownerId, expired = true) => ({ protocolVersion: 1, ownerId, runId: "run", targetOwnerId: "generation-a", pid: expired ? 99999999 : process.pid, hostname: expired ? "foreign" : process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00Z", expiresAt: expired ? "2000-01-01T00:00:01Z" : "2999-01-01T00:00:00Z", expiresAtEpoch: expired ? 946684801 : 32472144000 });
  await writeFile(lockPath, JSON.stringify(owner("generation-a"))); await writeFile(guardPath, JSON.stringify(owner("dead-guard")));
  let observed; const sawExpired = new Promise(resolve => { observed = resolve; }); let resume; const paused = new Promise(resolve => { resume = resolve; });
  const first = acquireInstallStateLock(statePath, { timeoutMs: 500, onExpiredGuardObserved: async () => { observed(); await paused; } }); await sawExpired;
  const second = await acquireInstallStateLock(statePath, { timeoutMs: 500 });
  resume(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(JSON.parse(await readFile(lockPath, "utf8")).ownerId, second.owner.ownerId);
  await second.release(); const firstResult = await first; await firstResult.release();
});

test("expired guard observation cannot delete a live replacement at the same path", { timeout: 1000 }, async () => {
  const { statePath } = await fixture(); const lockPath = `${statePath}.lock`; const guardPath = `${lockPath}.reclaim-deadguard`;
  const guard = (ownerId, expired) => ({ protocolVersion: 1, ownerId, runId: "run", targetOwnerId: "generation-a", pid: expired ? 99999999 : process.pid, hostname: expired ? "foreign" : process.env.COMPUTERNAME ?? "", acquiredAt: "2000-01-01T00:00:00Z", expiresAt: expired ? "2000-01-01T00:00:01Z" : "2999-01-01T00:00:00Z", expiresAtEpoch: expired ? 946684801 : 32472144000 });
  await writeFile(lockPath, JSON.stringify({ ...guard("generation-a", true), targetOwnerId: undefined }));
  await writeFile(guardPath, JSON.stringify(guard("expired-a", true)));
  let observed; const sawExpired = new Promise(resolve => { observed = resolve; }); let resume; const paused = new Promise(resolve => { resume = resolve; });
  const pending = acquireInstallStateLock(statePath, { timeoutMs: 80, onExpiredGuardObserved: async () => { observed(); await paused; } });
  await sawExpired;
  await writeFile(guardPath, JSON.stringify(guard("live-b", false)));
  resume();
  await assert.rejects(pending, /lock_timeout/);
  assert.equal(JSON.parse(await readFile(guardPath, "utf8")).ownerId, "live-b");
});

test("release never removes a lock now owned by another live owner", async () => {
  const { statePath } = await fixture();
  const held = await acquireInstallStateLock(statePath);
  const ownerPath = held.lockPath;
  await writeFile(ownerPath, JSON.stringify({ ...held.owner, ownerId: "replacement-owner" }));
  await held.release();
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).ownerId, "replacement-owner");
});

test("source byte CAS rejects a changed canonical file", async () => {
  const { statePath } = await fixture();
  const source = await readFile(statePath);
  const changed = JSON.parse(source); changed.installerVersion = "changed"; await writeFile(statePath, JSON.stringify(changed));
  await assert.rejects(updateInstallState(statePath, s => ({ ...s, installerVersion: "next" }), { expectedSourceSha256: sha256(source) }), /cas_mismatch/);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "changed");
});

test("temp is adjacent, canonical path never disappears, replacement is validated", async () => {
  const { statePath } = await fixture();
  let observedTemp;
  await updateInstallState(statePath, s => ({ ...s, installerVersion: "next" }), { onStage: async (stage, context) => {
    if (stage === "temp-flushed") {
      observedTemp = context.tempPath;
      assert.equal(dirname(context.tempPath), dirname(statePath));
      assert.ok(basename(context.tempPath).startsWith(".install-state.json.tmp-"));
      assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "test");
    }
    if (stage === "replaced") assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "next");
  }});
  assert.ok(observedTemp);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "next");
  await assert.rejects(readFile(`${statePath}.recovery`), /ENOENT/);
});

for (const crashStage of ["locked", "temp-created", "temp-flushed", "recovery-flushed", "replaced", "verified"]) {
  test(`recovery is deterministic after interruption at ${crashStage}`, async () => {
    const { dir, statePath } = await fixture();
    const recoveryPath = join(dir, "governed-recovery.json");
    await assert.rejects(updateInstallState(statePath, s => ({ ...s, installerVersion: "crash" }), { crashAfterStage: crashStage, recoveryPath }), /injected_crash/);
    await updateInstallState(statePath, s => ({ ...s, installerVersion: "recovered" }));
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).installerVersion, "recovered");
    assert.deepEqual((await readdir(dir)).filter(n => n.includes(".tmp-") || n.endsWith(".lock")), []);
  });
}

test("governed rollback restores exact recovery bytes under the shared lock", async () => {
  const { dir, statePath } = await fixture();
  const recoveryPath = join(dir, "governed-recovery.json");
  const original = await readFile(statePath);
  await writeFile(recoveryPath, original);
  await updateInstallState(statePath, state => ({ ...state, installerVersion: "migrated" }));
  await restoreInstallState(statePath, recoveryPath);
  assert.deepEqual(await readFile(statePath), original);
  assert.deepEqual((await readdir(dir)).filter(name => name.includes(".tmp-") || name.endsWith(".lock")), []);
});
