import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fsPromises, { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { loadOfflineRecoveryKit } from "./offline-recovery-kit.mjs";
import { prepareOfflineRecoveryKit } from "./offline-recovery-kit-prepare.mjs";
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

const posix = { skip: process.platform === "win32" };
test("prepares exact verified public files with private permissions and external enrollment", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "prepared");
  const result = await prepareOfflineRecoveryKit({ ...f.args, destination });
  const loaded = await loadOfflineRecoveryKit({ ...f.args, kitDirectory: destination });
  assert.equal(loaded.envelopeDigest, result.envelopeDigest);
  assert.deepEqual((await readdir(destination)).sort(), ["envelope-signatures.json", "envelope.json", "manifest-signatures.json", "manifest.json"]);
  for (const name of await readdir(destination)) {
    assert.deepEqual(await readFile(join(destination, name)), await readFile(join(f.kit, name)));
    assert.equal((await stat(join(destination, name))).mode & 0o777, 0o600);
  }
  assert.equal((await stat(destination)).mode & 0o777, 0o700);
});
test("does not create a destination from unapproved bytes", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "prepared");
  await writeFile(join(f.kit, "envelope.json"), "{}");
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination }), /offline_recovery_signature/);
  await assert.rejects(stat(destination), { code: "ENOENT" });
});
test("never replaces an existing destination or follows its symlink", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "prepared");
  await mkdir(destination, { mode: 0o700 }); await writeFile(join(destination, "keep"), "original");
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination }), /EEXIST/);
  assert.equal(await readFile(join(destination, "keep"), "utf8"), "original");
  const alias = join(f.dir, "alias"); await symlink(destination, alias);
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination: alias }), /EEXIST/);
});
test("rejects a writable destination parent before creating a kit", posix, async t => {
  const f = await fixture(t); const parent = join(f.dir, "unsafe"); await mkdir(parent); await chmod(parent, 0o777);
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination: join(parent, "prepared") }), /offline_recovery_kit_permissions/);
  assert.deepEqual(await readdir(parent), []);
});

test("an interrupted write leaves a rejected partial kit and preserves its source", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "partial");
  const canonicalDestination = join(await realpath(f.dir), "partial");
  const originalOpen = fsPromises.open; let injected = false;
  const mocked = t.mock.method(fsPromises, "open", async (path, ...args) => {
    if (path === join(canonicalDestination, "envelope-signatures.json") && args[0] === "wx") {
      injected = true; throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
    }
    return originalOpen(path, ...args);
  });
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination }), { code: "ENOSPC" });
  assert.equal(injected, true);
  await assert.rejects(loadOfflineRecoveryKit({ ...f.args, kitDirectory: destination }), /offline_recovery_kit_file/);
  assert.equal((await loadOfflineRecoveryKit(f.args)).envelopeDigest, hash(f.envelopeBytes));
});
test("source mutation after verification cannot replace the captured approved bytes", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "prepared");
  const canonicalDestination = join(await realpath(f.dir), "prepared");
  const manifest = await readFile(join(f.kit, "manifest.json"));
  const originalOpen = fsPromises.open; let injected = false;
  const mocked = t.mock.method(fsPromises, "open", async (path, ...args) => {
    if (path === join(canonicalDestination, "manifest.json") && args[0] === "wx") {
      injected = true; await writeFile(join(f.kit, "manifest.json"), "{}");
    }
    return originalOpen(path, ...args);
  });
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await prepareOfflineRecoveryKit({ ...f.args, destination });
  assert.equal(injected, true);
  assert.deepEqual(await readFile(join(destination, "manifest.json")), manifest);
  await loadOfflineRecoveryKit({ ...f.args, kitDirectory: destination });
});

test("late directory flush failure preserves a complete kit without reporting preparation success", posix, async t => {
  const f = await fixture(t); const destination = join(f.dir, "prepared");
  const canonicalDestination = join(await realpath(f.dir), "prepared");
  const originalOpen = fsPromises.open; let injected = false;
  const mocked = t.mock.method(fsPromises, "open", async (path, ...args) => {
    const handle = await originalOpen(path, ...args);
    if (path === canonicalDestination && args[0] === "r") {
      handle.sync = async () => { injected = true; throw Object.assign(new Error("fixture flush failed"), { code: "EIO" }); };
    }
    return handle;
  });
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(prepareOfflineRecoveryKit({ ...f.args, destination }), { code: "EIO" });
  assert.equal(injected, true);
  const loaded = await loadOfflineRecoveryKit({ ...f.args, kitDirectory: destination });
  assert.equal(loaded.envelopeDigest, hash(f.envelopeBytes));
});
