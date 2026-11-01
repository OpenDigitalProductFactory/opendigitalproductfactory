import { createHash, createPublicKey, verify } from "node:crypto";
import { isAbsolute, win32 } from "node:path";
import { canonicalJson } from "../lib/canonical-json.mjs";

const ROLES = ["operator", "verifier"];
const HASH = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const BINDINGS = ["installationId", "hostId", "daemonId", "statePath", "composeProject",
  "configurationSha256", "composeSha256", "stateSha256", "mountsSha256"];
const fail = code => { throw new Error(`offline_recovery_${code}`); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function fields(value, names) {
  if (!object(value) || Object.keys(value).length !== names.length
    || !names.every(name => Object.hasOwn(value, name))) fail("fields");
}

function signedBytes(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > 65536) fail("encoding");
  return value;
}

function parseCanonical(bytes) {
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    // Exact serialization rejects duplicate keys, whitespace variants, rounded
    // numeric spellings and invalid byte sequences without a second parser.
    if (canonicalJson(value) !== text) fail("encoding");
    const inspect = entry => {
      if (typeof entry === "string" && !entry.isWellFormed()) fail("encoding");
      if (typeof entry === "number" && !Number.isSafeInteger(entry)) fail("encoding");
      if (entry && typeof entry === "object") {
        for (const [key, child] of Object.entries(entry)) { inspect(key); inspect(child); }
      }
    };
    inspect(value);
  } catch { fail("encoding"); }
  return value;
}

function timestamp(value) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail("time");
  return ms;
}

function checkSignatures(bytes, signatures, publicKeys) {
  if (!Array.isArray(signatures) || signatures.length !== 2) fail("signature");
  for (const role of ROLES) {
    const matches = signatures.filter(entry => entry?.role === role);
    if (matches.length !== 1) fail("signature");
    const entry = matches[0];
    fields(entry, ["role", "fingerprint", "signature"]);
    const key = publicKeys[role];
    if (entry.fingerprint !== key.fingerprint || typeof entry.signature !== "string") fail("signature");
    const signature = Buffer.from(entry.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== entry.signature
      || !verify(null, bytes, key.key, signature)) fail("signature");
  }
}

/**
 * Pure validation, with no runtime or filesystem effects. Pins, minimum epoch
 * and observed state MUST come from the protected local enrollment/inspection
 * adapter, never from the recovery bundle. A successful result is not a lease,
 * an execution receipt or permission to skip lock/revalidation before apply.
 */
/** Verify a witnessed manifest against administrator-supplied pins, independent
 * of any kit or recovery envelope. This cannot authorize runtime effects. */
export function verifyOfflineRecoveryTrust({ manifestBytes, manifestSignatures,
  trustedKeyFingerprints, minimumTrustEpoch, installationId, nowMs }) {
  signedBytes(manifestBytes);
  if (!object(trustedKeyFingerprints)
    || Object.keys(trustedKeyFingerprints).length !== 2
    || !ROLES.every(role => HASH.test(trustedKeyFingerprints[role] ?? ""))
    || trustedKeyFingerprints.operator === trustedKeyFingerprints.verifier) fail("trust_key");
  if (typeof installationId !== "string" || !installationId
    || /[\u0000-\u001f]/.test(installationId)) fail("binding");
  if (!Number.isSafeInteger(nowMs)) fail("time");
  const manifest = parseCanonical(manifestBytes);
  fields(manifest, ["version", "installationId", "epoch", "issuedAt", "expiresAt", "keys"]);
  if (manifest.version !== 1) fail("version");
  if (!Array.isArray(manifest.keys) || manifest.keys.length !== 2) fail("trust_key");
  const publicKeys = {};
  for (const role of ROLES) {
    const matches = manifest.keys.filter(entry => entry?.role === role);
    if (matches.length !== 1) fail("trust_key");
    const entry = matches[0];
    fields(entry, ["role", "fingerprint", "publicKey", "revoked"]);
    if (entry.revoked !== false || entry.fingerprint !== trustedKeyFingerprints[role]
      || typeof entry.publicKey !== "string"
      || !entry.publicKey.startsWith("-----BEGIN PUBLIC KEY-----\n")) fail("trust_key");
    let key;
    try { key = createPublicKey(entry.publicKey); } catch { fail("trust_key"); }
    if (key.export({ type: "spki", format: "pem" }) !== entry.publicKey
      || key.asymmetricKeyType !== "ed25519"
      || sha256(key.export({ type: "spki", format: "der" })) !== entry.fingerprint) fail("trust_key");
    publicKeys[role] = { key, fingerprint: entry.fingerprint };
  }
  checkSignatures(manifestBytes, manifestSignatures, publicKeys);
  if (manifest.installationId !== installationId) fail("binding");
  if (!Number.isSafeInteger(minimumTrustEpoch) || minimumTrustEpoch < 1
    || !Number.isSafeInteger(manifest.epoch) || manifest.epoch < minimumTrustEpoch) fail("trust_epoch");
  const trustExpiry = timestamp(manifest.expiresAt);
  if (timestamp(manifest.issuedAt) > nowMs) fail("time");
  if (trustExpiry <= nowMs) fail("trust_expired");

  return { manifest, publicKeys, trustExpiry, trustEpoch: manifest.epoch,
    manifestDigest: sha256(manifestBytes) };
}

export function verifyOfflineRecoveryAuthority({
  manifestBytes, manifestSignatures, envelopeBytes, envelopeSignatures,
  trustedKeyFingerprints, minimumTrustEpoch, observed, nowMs,
}) {
  signedBytes(manifestBytes); signedBytes(envelopeBytes);
  if (!object(trustedKeyFingerprints)
    || !ROLES.every(role => HASH.test(trustedKeyFingerprints[role] ?? ""))
    || trustedKeyFingerprints.operator === trustedKeyFingerprints.verifier) fail("trust_key");
  if (!object(observed)) fail("binding");
  if (!Number.isSafeInteger(nowMs)) fail("time");
  const { manifest, publicKeys, trustExpiry } = verifyOfflineRecoveryTrust({
    manifestBytes, manifestSignatures, trustedKeyFingerprints, minimumTrustEpoch,
    installationId: observed.installationId, nowMs,
  });

  // Verify approval of exact bytes before interpreting the recovery plan.
  checkSignatures(envelopeBytes, envelopeSignatures, publicKeys);
  const envelope = parseCanonical(envelopeBytes);
  fields(envelope, ["version", "runId", ...BINDINGS, "issuedAt", "expiresAt",
    "rollbackDeadlineAt", "maxExecutionMs", "actions", "services"]);
  if (envelope.version !== 1) fail("version");
  if (!/^OR-[A-Za-z0-9-]{1,80}$/.test(envelope.runId ?? "")) fail("binding");
  const issued = timestamp(envelope.issuedAt);
  const expiry = timestamp(envelope.expiresAt);
  const rollbackDeadline = timestamp(envelope.rollbackDeadlineAt);
  if (expiry <= nowMs) fail("expired");
  if (issued > nowMs || issued >= expiry || rollbackDeadline <= expiry
    || rollbackDeadline > trustExpiry || rollbackDeadline - issued > 86400000) fail("time");
  if (!Number.isSafeInteger(envelope.maxExecutionMs) || envelope.maxExecutionMs <= 0
    || envelope.maxExecutionMs > expiry - nowMs) fail("budget");
  for (const name of BINDINGS) {
    const value = envelope[name];
    if (typeof value !== "string" || !value || value.length > 4096
      || /[\u0000-\u001f]/.test(value) || value !== observed[name]) fail("binding");
    if (name.endsWith("Sha256") && !HASH.test(value)) fail("binding");
  }
  if ((!isAbsolute(envelope.statePath) && !win32.isAbsolute(envelope.statePath))
    || envelope.statePath.split(/[\\/]/).some(part => part === "..")
    || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(envelope.composeProject)) fail("binding");
  if (!Array.isArray(envelope.actions) || envelope.actions.length !== 2
    || !["restore-services", "restore-state"].every(action => envelope.actions.includes(action))) fail("action");
  if (!Array.isArray(envelope.services) || envelope.services.length < 1 || envelope.services.length > 3
    || !Array.isArray(observed.services) || observed.services.length !== envelope.services.length) fail("service");
  const seen = new Set();
  for (const service of envelope.services) {
    fields(service, ["name", "currentImage", "targetImage", "rollbackImage"]);
    if (!["portal", "portal-init", "promoter"].includes(service.name) || seen.has(service.name)) fail("service");
    seen.add(service.name);
    if (![service.currentImage, service.targetImage, service.rollbackImage].every(value => typeof value === "string" && IMAGE.test(value))) fail("image");
    if (service.rollbackImage !== service.currentImage) fail("rollback");
    const matches = observed.services.filter(entry => entry?.name === service.name);
    if (matches.length !== 1 || matches[0].currentImage !== service.currentImage) fail("binding");
  }
  return { envelope, envelopeDigest: sha256(envelopeBytes), trustEpoch: manifest.epoch,
    manifestDigest: sha256(manifestBytes), expiresAt: envelope.expiresAt };
}
