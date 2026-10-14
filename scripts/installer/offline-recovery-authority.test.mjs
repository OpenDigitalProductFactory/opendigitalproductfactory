import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../lib/canonical-json.mjs";
import { verifyOfflineRecoveryAuthority } from "./offline-recovery-authority.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(canonicalJson(value), "utf8");
const keys = Object.fromEntries(["operator", "verifier"].map(role => [role, generateKeyPairSync("ed25519")]));
const fingerprint = key => digest(key.export({ type: "spki", format: "der" }));
const pins = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, fingerprint(key.publicKey)]));
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const image = char => `sha256:${char.repeat(64)}`;
const signBoth = bytes => Object.entries(keys).map(([role, key]) => ({
  role, fingerprint: pins[role], signature: sign(null, bytes, key.privateKey).toString("base64"),
}));

function fixture() {
  const observed = {
    installationId: "install-fixture", hostId: "host-fixture", daemonId: "daemon-fixture",
    statePath: "/fixture/install-state.json", composeProject: "recovery-fixture",
    configurationSha256: "a".repeat(64), composeSha256: "b".repeat(64),
    stateSha256: "c".repeat(64), mountsSha256: "d".repeat(64),
    services: [{ name: "portal", currentImage: image("e") }],
  };
  const manifest = {
    version: 1, installationId: observed.installationId, epoch: 4,
    issuedAt: iso(-60000), expiresAt: iso(3600000),
    keys: Object.entries(keys).map(([role, key]) => ({
      role, fingerprint: pins[role], publicKey: key.publicKey.export({ type: "spki", format: "pem" }), revoked: false,
    })),
  };
  const envelope = {
    version: 1, runId: "OR-fixture-1", ...observed,
    issuedAt: iso(-1000), expiresAt: iso(60000), rollbackDeadlineAt: iso(120000),
    maxExecutionMs: 30000, actions: ["restore-services", "restore-state"],
    services: [{ ...observed.services[0], targetImage: image("f"), rollbackImage: image("e") }],
  };
  const manifestBytes = encode(manifest);
  const envelopeBytes = encode(envelope);
  return { manifest, envelope, args: {
    manifestBytes, manifestSignatures: signBoth(manifestBytes),
    envelopeBytes, envelopeSignatures: signBoth(envelopeBytes),
    trustedKeyFingerprints: { ...pins }, minimumTrustEpoch: 4, observed, nowMs: now,
  } };
}
function changeEnvelope(f, change) {
  change(f.envelope); f.args.envelopeBytes = encode(f.envelope);
  f.args.envelopeSignatures = signBoth(f.args.envelopeBytes);
}
function changeManifest(f, change) {
  change(f.manifest); f.args.manifestBytes = encode(f.manifest);
  f.args.manifestSignatures = signBoth(f.args.manifestBytes);
}

test("two independently pinned signatures admit only the observed immutable target", () => {
  const f = fixture(); const result = verifyOfflineRecoveryAuthority(f.args);
  assert.equal(result.envelopeDigest, digest(f.args.envelopeBytes));
  assert.equal(result.trustEpoch, 4);
  assert.equal(result.envelope.runId, "OR-fixture-1");
});

for (const [name, change, code] of [
  ["expired forward authority", e => { e.expiresAt = iso(-1); }, "expired"],
  ["future issue", e => { e.issuedAt = iso(1); }, "time"],
  ["rollback before forward expiry", e => { e.rollbackDeadlineAt = iso(1000); }, "time"],
  ["execution budget exceeding forward authority", e => { e.maxExecutionMs = 90000; }, "budget"],
  ["cross-install", e => { e.installationId = "other"; }, "binding"],
  ["other host", e => { e.hostId = "other"; }, "binding"],
  ["other daemon", e => { e.daemonId = "other"; }, "binding"],
  ["changed mount", e => { e.mountsSha256 = "1".repeat(64); }, "binding"],
  ["changed configuration", e => { e.configurationSha256 = "1".repeat(64); }, "binding"],
  ["changed state", e => { e.stateSha256 = "1".repeat(64); }, "binding"],
  ["mutable target tag", e => { e.services[0].targetImage = "portal:latest"; }, "image"],
  ["rollback differs from preserved image", e => { e.services[0].rollbackImage = image("a"); }, "rollback"],
  ["data service", e => { e.services[0].name = "postgres"; }, "service"],
  ["duplicate service", e => { e.services.push({ ...e.services[0] }); }, "service"],
  ["arbitrary command", e => { e.command = "sh -c unsafe"; }, "fields"],
  ["migration action", e => { e.actions.push("migrate"); }, "action"],
  ["unknown version", e => { e.version = 2; }, "version"],
]) test(`rejects ${name} even with valid signatures`, () => {
  const f = fixture(); changeEnvelope(f, change);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), new RegExp(`offline_recovery_${code}`));
});

for (const [name, change, code] of [
  ["trust epoch rollback", m => { m.epoch = 3; }, "trust_epoch"],
  ["expired trust", m => { m.expiresAt = iso(-1); }, "trust_expired"],
  ["revoked verifier", m => { m.keys[1].revoked = true; }, "trust_key"],
  ["one signer in both roles", m => { m.keys[1] = { ...m.keys[0], role: "verifier" }; }, "trust_key"],
]) test(`rejects ${name}`, () => {
  const f = fixture(); changeManifest(f, change);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), new RegExp(`offline_recovery_${code}`));
});

test("rejects forged signature and missing approval independently", () => {
  const f = fixture(); f.args.envelopeSignatures[0].signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_signature/);
  f.args.envelopeSignatures = signBoth(f.args.envelopeBytes).slice(0, 1);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_signature/);
});
test("manifest cannot nominate an unpinned authority", () => {
  const f = fixture(); f.args.trustedKeyFingerprints.operator = "0".repeat(64);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_trust_key/);
});
test("rejects altered envelope bytes before interpreting them", () => {
  const f = fixture(); f.args.envelopeBytes = Buffer.from(f.args.envelopeBytes.toString().replace("OR-fixture-1", "OR-fixture-2"));
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_signature/);
});
test("rejects duplicate JSON keys despite valid signatures", () => {
  const f = fixture(); f.args.envelopeBytes = Buffer.from(f.args.envelopeBytes.toString().replace('{', '{"version":1,'));
  f.args.envelopeSignatures = signBoth(f.args.envelopeBytes);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_encoding/);
});
test("rejects missing pinned trust, unknown observation and oversized input", () => {
  const f = fixture();
  assert.throws(() => verifyOfflineRecoveryAuthority({ ...f.args, trustedKeyFingerprints: null }), /offline_recovery_trust_key/);
  assert.throws(() => verifyOfflineRecoveryAuthority({ ...f.args, observed: null }), /offline_recovery_binding/);
  assert.throws(() => verifyOfflineRecoveryAuthority({ ...f.args, envelopeBytes: Buffer.alloc(70000) }), /offline_recovery_encoding/);
});

test("rejects forged manifest approval before trusting its policy", () => {
  const f = fixture(); f.args.manifestSignatures[1].signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_signature/);
});
test("requires a protected epoch floor and both distinct approval roles", () => {
  const f = fixture();
  assert.throws(() => verifyOfflineRecoveryAuthority({ ...f.args, minimumTrustEpoch: undefined }), /offline_recovery_trust_epoch/);
  f.args.envelopeSignatures[1] = { ...f.args.envelopeSignatures[0] };
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_signature/);
});
test("rejects signed noncanonical JSON and ill-formed Unicode", () => {
  const f = fixture();
  f.args.envelopeBytes = Buffer.from(JSON.stringify(f.envelope, null, 2));
  f.args.envelopeSignatures = signBoth(f.args.envelopeBytes);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_encoding/);
  changeEnvelope(f, e => { e.hostId = "\ud800"; });
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_encoding/);
});
test("refuses invalid UTF-8 and noninteger signed budgets", () => {
  const f = fixture(); f.args.envelopeBytes = Buffer.from([0xc0, 0xaf]);
  f.args.envelopeSignatures = signBoth(f.args.envelopeBytes);
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_encoding/);
  changeEnvelope(f, e => { e.maxExecutionMs = 1.5; });
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_encoding/);
});
test("rejects traversal even when observed input echoes it", () => {
  const f = fixture(); changeEnvelope(f, e => { e.statePath = "/fixture/../other/state.json"; });
  f.args.observed.statePath = f.envelope.statePath;
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_binding/);
});

for (const representation of ["private", "public-and-private"]) test(`rejects signed ${representation} PEM in public trust material`, () => {
  const f = fixture();
  changeManifest(f, m => {
    const key = m.keys.find(k => k.role === "operator");
    const privatePem = keys.operator.privateKey.export({ type: "pkcs8", format: "pem" });
    key.publicKey = representation === "private" ? privatePem : key.publicKey + privatePem;
  });
  assert.throws(() => verifyOfflineRecoveryAuthority(f.args), /offline_recovery_trust_key/);
});
