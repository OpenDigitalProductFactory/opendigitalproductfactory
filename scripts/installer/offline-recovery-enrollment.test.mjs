import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fsPromises, { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { enrollOfflineRecoveryAuthority } from "./offline-recovery-enrollment.mjs";

const posix = { skip: process.platform === "win32" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "dpf-enrollment-")));
  await chmod(dir, 0o700); t.after(() => rm(dir, { recursive: true, force: true }));
  const keys = Object.fromEntries(["operator", "verifier"].map(role => [role, generateKeyPairSync("ed25519")]));
  const trustedKeyFingerprints = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, hash(key.publicKey.export({ type: "spki", format: "der" }))]));
  const nowMs = Date.now();
  const manifest = { version: 1, installationId: "test-install", epoch: 4,
    issuedAt: new Date(nowMs - 1000).toISOString(), expiresAt: new Date(nowMs + 60000).toISOString(),
    keys: Object.entries(keys).map(([role, key]) => ({ role, fingerprint: trustedKeyFingerprints[role], publicKey: key.publicKey.export({ type: "spki", format: "pem" }), revoked: false })) };
  const seal = () => {
    const manifestBytes = Buffer.from(canonicalJson(manifest));
    return { manifestBytes, manifestSignatures: Object.entries(keys).map(([role, key]) => ({ role, fingerprint: trustedKeyFingerprints[role], signature: sign(null, manifestBytes, key.privateKey).toString("base64") })) };
  };
  return { dir, manifest, seal, args: { destination: join(dir, "enrollment.json"), installationId: "test-install", trustedKeyFingerprints, nowMs, ...seal() } };
}

test("enrolls witnessed public keys into a new private canonical trust file", posix, async t => {
  const f = await fixture(t); const result = await enrollOfflineRecoveryAuthority(f.args);
  assert.deepEqual(JSON.parse(await readFile(f.args.destination, "utf8")), { version: 1, installationId: "test-install", minimumTrustEpoch: 4, trustedKeyFingerprints: f.args.trustedKeyFingerprints });
  assert.equal(result.manifestDigest, hash(f.args.manifestBytes));
  assert.equal(result.trustEpoch, 4);
  assert.equal((await stat(f.args.destination)).mode & 0o777, 0o600);
});
for (const failure of ["signature", "pin", "installation", "expiry"]) test(`refuses ${failure} before creating trust`, posix, async t => {
  const f = await fixture(t);
  if (failure === "signature") f.args.manifestSignatures[1].signature = Buffer.alloc(64).toString("base64");
  if (failure === "pin") f.args.trustedKeyFingerprints.verifier = "f".repeat(64);
  if (failure === "installation") f.args.installationId = "other-install";
  if (failure === "expiry") f.args.nowMs += 60001;
  await assert.rejects(enrollOfflineRecoveryAuthority(f.args), /offline_recovery_(signature|trust_key|binding|trust_expired)/);
  await assert.rejects(readFile(f.args.destination), { code: "ENOENT" });
});
test("preserves existing enrollment and its epoch without overwrite", posix, async t => {
  const f = await fixture(t); const original = '{"preserved":"higher-epoch-or-diagnostic"}';
  await writeFile(f.args.destination, original, { mode: 0o600 });
  await assert.rejects(enrollOfflineRecoveryAuthority(f.args), { code: "EEXIST" });
  assert.equal(await readFile(f.args.destination, "utf8"), original);
});
test("two simultaneous enrollment attempts produce exactly one writer", posix, async t => {
  const f = await fixture(t); const results = await Promise.allSettled([enrollOfflineRecoveryAuthority(f.args), enrollOfflineRecoveryAuthority(f.args)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "EEXIST");
});
test("refuses symlink destination and preserves its target", posix, async t => {
  const f = await fixture(t); const target = join(f.dir, "target"); await writeFile(target, "preserve");
  await symlink(target, f.args.destination);
  await assert.rejects(enrollOfflineRecoveryAuthority(f.args), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "preserve");
});
test("refuses a publicly writable parent before enrollment", posix, async t => {
  const f = await fixture(t); await chmod(f.dir, 0o777);
  await assert.rejects(enrollOfflineRecoveryAuthority(f.args), /offline_recovery_kit_permissions/);
  await assert.rejects(readFile(f.args.destination), { code: "ENOENT" });
});
test("refuses replacement of the opened enrollment file even with identical bytes", posix, async t => {
  const f = await fixture(t); const originalOpen = fsPromises.open;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.args.destination && args[1] === "wx") {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        await originalSync();
        const bytes = await readFile(f.args.destination);
        await rename(f.args.destination, `${f.args.destination}.original`);
        await writeFile(f.args.destination, bytes, { mode: 0o600 });
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(enrollOfflineRecoveryAuthority(f.args), /offline_recovery_enrollment_changed/); }
  finally { fsPromises.open = originalOpen; syncBuiltinESMExports(); }
  assert.deepEqual(await readFile(f.args.destination), await readFile(`${f.args.destination}.original`));
});
test("refuses parent generation replacement and preserves both directories", posix, async t => {
  const f = await fixture(t); const originalOpen = fsPromises.open;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.args.destination && args[1] === "wx") {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        await originalSync(); await rename(f.dir, `${f.dir}.original`);
        await mkdir(f.dir, { mode: 0o700 });
      };
    }
    return handle;
  };
  syncBuiltinESMExports(); t.after(() => rm(`${f.dir}.original`, { recursive: true, force: true }));
  try { await assert.rejects(enrollOfflineRecoveryAuthority(f.args), /offline_recovery_enrollment_changed/); }
  finally { fsPromises.open = originalOpen; syncBuiltinESMExports(); }
  assert.equal(JSON.parse(await readFile(join(`${f.dir}.original`, "enrollment.json"))).minimumTrustEpoch, 4);
  await assert.rejects(readFile(f.args.destination), { code: "ENOENT" });
});
test("late directory sync failure retains complete enrollment for inspection", posix, async t => {
  const f = await fixture(t); const originalOpen = fsPromises.open;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.dir && args[1] === "r") handle.sync = async () => { throw Object.assign(new Error("fixture EIO"), { code: "EIO" }); };
    return handle;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(enrollOfflineRecoveryAuthority(f.args), { code: "EIO" }); }
  finally { fsPromises.open = originalOpen; syncBuiltinESMExports(); }
  assert.equal(JSON.parse(await readFile(f.args.destination)).minimumTrustEpoch, 4);
});
