import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Canonical top-level serialization retained byte-for-byte for compatibility. */
export function canonicalTransitionPayload(value) {
  if (value?.kind === "install-state-migration") return recursiveCanonicalJson(value);
  return JSON.stringify(value, Object.keys(value).sort());
}

function recursiveCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(recursiveCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${recursiveCanonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Sign a transition-shaped payload using the existing runtime secret. */
export function signTransitionPayload(value, secret) {
  if (secret.length < 32) throw new Error("runtime_transition_secret_too_short");
  return createHmac("sha256", secret).update(canonicalTransitionPayload(value)).digest("hex");
}

export function verifyTransitionSignature(value, signature, secret) {
  const expected = signTransitionPayload(value, secret);
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("runtime_transition_payload_tampered");
  }
}

/** Verify the bounded readiness-to-promotion install-state handoff. */
export function verifyInstallStateMigrationEnvelope(envelope, signature, secret, expected) {
  verifyTransitionSignature(envelope, signature, secret);
  if (envelope.kind !== "install-state-migration" || envelope.version !== 1) throw new Error("install_state_envelope_invalid");
  if (!/^[a-f0-9]{64}$/.test(envelope.sourceHash ?? "") || !/^[a-f0-9]{64}$/.test(envelope.projectionHash ?? "")) throw new Error("install_state_envelope_invalid_hash");
  if (!Number.isInteger(envelope.fromSchemaVersion) || envelope.fromSchemaVersion < 1 || !Number.isInteger(envelope.toSchemaVersion) || envelope.toSchemaVersion < 1) throw new Error("install_state_envelope_invalid_schema");
  const identity = envelope.hostIdentity;
  if (!identity || !["win32", "darwin", "linux"].includes(identity.platform) || !["amd64", "arm64", "x86_64"].includes(identity.arch) || !["explicit", "legacy-windows-paths"].includes(identity.provenance)) throw new Error("install_state_envelope_invalid_identity");
  if (envelope.runId !== expected.runId) throw new Error("install_state_envelope_wrong_run");
  if (envelope.promoterDigest !== expected.promoterDigest) throw new Error("install_state_envelope_wrong_digest");
  if (envelope.sourceHash !== expected.sourceHash) throw new Error("install_state_envelope_state_changed");
  if (expected.hostIdentity && canonicalTransitionPayload(identity) !== canonicalTransitionPayload(expected.hostIdentity)) throw new Error("install_state_envelope_wrong_identity");
  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expected.now < issuedAt - 30_000 || expected.now > expiresAt) {
    throw new Error("install_state_envelope_expired");
  }
  return envelope;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const envelope = JSON.parse(Buffer.from(process.env.DPF_INSTALL_STATE_MIGRATION_ENVELOPE ?? "", "base64url").toString("utf8"));
    const secret = (await readFile(process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE ?? "/run/secrets/dpf-runtime-transition", "utf8")).trim();
    const stateBytes = await readFile(`${process.env.DPF_STATE_DIR ?? "/dpf-state"}/install-state.json`);
    verifyInstallStateMigrationEnvelope(envelope, process.env.DPF_INSTALL_STATE_MIGRATION_SIGNATURE ?? "", secret, {
      runId: process.env.DPF_SELF_UPGRADE_RUN_ID, promoterDigest: process.env.DPF_PROMOTER_DIGEST,
      sourceHash: createHash("sha256").update(stateBytes).digest("hex"), now: Date.now(),
    });
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "install_state_envelope_invalid"}\n`);
    process.exitCode = 78;
  }
}
