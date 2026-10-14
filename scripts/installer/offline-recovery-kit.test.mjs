import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { loadOfflineRecoveryKit } from "./offline-recovery-kit.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => Buffer.from(canonicalJson(value));
const image = letter => `sha256:${letter.repeat(64)}`;
const keys = Object.fromEntries(["operator", "verifier"].map(role => [role, generateKeyPairSync("ed25519")]));
const pins = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, hash(key.publicKey.export({ type: "spki", format: "der" }))]));
const signatures = data => Object.entries(keys).map(([role, key]) => ({ role, fingerprint: pins[role], signature: sign(null, data, key.privateKey).toString("base64") }));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-offline-kit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await chmod(dir, 0o700);
  const kit = join(dir, "kit"); await mkdir(kit, { mode: 0o700 });
  const nowMs = Date.now(); const iso = delta => new Date(nowMs + delta).toISOString();
  const observed = { installationId: "fixture", hostId: "host", daemonId: "daemon", statePath: join(dir, "state.json"), composeProject: "fixture", configurationSha256: "a".repeat(64), composeSha256: "b".repeat(64), stateSha256: "c".repeat(64), mountsSha256: "d".repeat(64), services: [{ name: "portal", currentImage: image("e") }] };
  const manifest = { version: 1, installationId: "fixture", epoch: 2, issuedAt: iso(-1000), expiresAt: iso(3600000), keys: Object.entries(keys).map(([role, key]) => ({ role, fingerprint: pins[role], publicKey: key.publicKey.export({ type: "spki", format: "pem" }), revoked: false })) };
  const envelope = { version: 1, runId: "OR-fixture", ...observed, issuedAt: iso(-1000), expiresAt: iso(60000), rollbackDeadlineAt: iso(120000), maxExecutionMs: 30000, actions: ["restore-services", "restore-state"], services: [{ ...observed.services[0], targetImage: image("f"), rollbackImage: image("e") }] };
  const manifestBytes = bytes(manifest); const envelopeBytes = bytes(envelope);
  for (const [name, data] of Object.entries({ "manifest.json": manifestBytes, "manifest-signatures.json": bytes(signatures(manifestBytes)), "envelope.json": envelopeBytes, "envelope-signatures.json": bytes(signatures(envelopeBytes)) })) await writeFile(join(kit, name), data, { mode: 0o600 });
  const trustFile = join(dir, "enrollment.json");
  await writeFile(trustFile, bytes({ version: 1, installationId: "fixture", minimumTrustEpoch: 2, trustedKeyFingerprints: pins }), { mode: 0o600 });
  return { dir, kit, trustFile, args: { kitDirectory: kit, trustFile, observed, nowMs }, envelopeBytes };
}

const posix = { skip: process.platform === "win32" ? "Windows ACL adapter not yet implemented; loader must fail closed" : false };
test("loads separately enrolled pins and verifies both approvals without platform access", posix, async t => {
  const f = await fixture(t); const result = await loadOfflineRecoveryKit(f.args);
  assert.equal(result.envelopeDigest, hash(f.envelopeBytes));
  assert.equal(result.envelope.runId, "OR-fixture");
  assert.equal(result.trustEpoch, 2);
});
test("a kit cannot carry its own trusted enrollment", posix, async t => {
  const f = await fixture(t); const trustFile = join(f.kit, "enrollment.json");
  await writeFile(trustFile, await readFile(f.trustFile), { mode: 0o600 });
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, trustFile }), /offline_recovery_kit_trust_location/);
});
for (const [name, mode] of [["group-writable", 0o620], ["world-readable", 0o604]]) test(`refuses ${name} trust file`, posix, async t => {
  const f = await fixture(t); await chmod(f.trustFile, mode);
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_permissions/);
});
test("refuses a kit directory writable by another user", posix, async t => {
  const f = await fixture(t); await chmod(f.kit, 0o777);
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_permissions/);
});
for (const kind of ["symbolic", "hard"]) test(`refuses ${kind} linked signed input`, posix, async t => {
  const f = await fixture(t); const target = join(f.kit, "envelope.json"); const other = join(f.dir, "other.json");
  await writeFile(other, f.envelopeBytes, { mode: 0o600 }); await rm(target);
  if (kind === "symbolic") await symlink(other, target); else await link(other, target);
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_file/);
});
test("refuses symlinked kit and enrollment directories", posix, async t => {
  const f = await fixture(t); const alias = join(f.dir, "alias"); await symlink(f.kit, alias);
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, kitDirectory: alias }), /offline_recovery_kit_directory/);
  const enrollmentAlias = join(f.dir, "enrollment-alias"); await symlink(f.dir, enrollmentAlias);
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, trustFile: join(enrollmentAlias, "enrollment.json") }), /offline_recovery_kit_directory/);
});
test("refuses incomplete kit, oversized data and malformed enrollment", posix, async t => {
  const f = await fixture(t); const path = join(f.kit, "manifest-signatures.json"); await rm(path);
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_file/);
  await writeFile(path, Buffer.alloc(70000), { mode: 0o600 });
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_size/);
  await writeFile(f.trustFile, '{"version":1}', { mode: 0o600 });
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_enrollment/);
});
test("rejects a validly signed bundle against a different observed installation", posix, async t => {
  const f = await fixture(t);
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, observed: { ...f.args.observed, installationId: "other" } }), /offline_recovery_kit_enrollment/);
});
test("refuses a linked enrollment file", posix, async t => {
  const f = await fixture(t); const alias = join(f.dir, "trust-alias.json"); await symlink(f.trustFile, alias);
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, trustFile: alias }), /offline_recovery_kit_file/);
});
test("rejects duplicate keys in the protected enrollment", posix, async t => {
  const f = await fixture(t); const text = (await readFile(f.trustFile, "utf8")).replace('{', '{"version":1,');
  await writeFile(f.trustFile, text);
  await assert.rejects(loadOfflineRecoveryKit(f.args), /offline_recovery_kit_enrollment/);
});
test("Windows refuses before trusting permission bits", { skip: process.platform !== "win32" }, async () => {
  await assert.rejects(loadOfflineRecoveryKit({}), /offline_recovery_kit_permissions_unavailable/);
});

test("refuses an intermediate alias beneath an unsafe original ancestor", posix, async t => {
  const f = await fixture(t);
  const unsafe = join(f.dir, "unsafe");
  await mkdir(unsafe); await chmod(unsafe, 0o777);
  const alias = join(unsafe, "alias"); await symlink(f.dir, alias);
  const store = join(f.dir, "store"); await mkdir(store, { mode: 0o700 });
  await writeFile(join(store, "enrollment.json"), await readFile(f.trustFile), { mode: 0o600 });
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, trustFile: join(alias, "store", "enrollment.json") }), /offline_recovery_kit_permissions/);
});

test("accepts an owned intermediate alias beneath protected ancestors", posix, async t => {
  const f = await fixture(t);
  const alias = join(f.dir, "alias"); await symlink(f.dir, alias);
  const store = join(f.dir, "store"); await mkdir(store, { mode: 0o700 });
  await writeFile(join(store, "enrollment.json"), await readFile(f.trustFile), { mode: 0o600 });
  const result = await loadOfflineRecoveryKit({ ...f.args, trustFile: join(alias, "store", "enrollment.json") });
  assert.equal(result.envelopeDigest, hash(f.envelopeBytes));
});
