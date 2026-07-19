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

/**
 * Closed set of host-identity provenances an envelope may carry. Mirrors what
 * scripts/installer/resolve-host-identity.mjs can return — `install-state` was
 * added with the N-1 readiness fix (BI-D47955AF) and must be accepted here, or
 * a portal on an install whose .env predates DPF_HOST_* builds a valid envelope
 * the promoter then rejects.
 */
export const HOST_IDENTITY_PROVENANCE = ["explicit", "install-state", "legacy-windows-paths"];

/** How long a self-issued envelope stays valid — long enough to cover the migrate step, no longer. */
const SELF_ISSUED_TTL_MS = 10 * 60_000;

/**
 * Issue a migration envelope from the candidate's OWN projection, for callers
 * that predate the signed handoff (BI-76651B7B).
 *
 * promote.sh requires an envelope the deployed portal has no code to produce —
 * the same trapdoor that wedged readiness, one gate later. The candidate signs
 * one itself with the runtime transition secret it already mounts.
 *
 * Honest limit: a caller-issued envelope binds the portal's READINESS
 * projection to the promotion write, so a state change between those two points
 * is detected. A self-issued one is computed at promotion time, so it cannot
 * attest to anything earlier than itself — it narrows the window to
 * (issue -> write) rather than closing (readiness -> write). The write is still
 * bound: migrate-install-state re-checks these exact hashes inside the
 * transaction. `issuer` records which of the two an envelope is, so evidence
 * never conflates them.
 */
export function issueSelfSignedMigrationEnvelope({ secret, promoterDigest, now, sourceHash, projectionHash, fromSchemaVersion, toSchemaVersion, hostIdentity }) {
  const envelope = {
    version: 1,
    kind: "install-state-migration",
    runId: `SUR-candidate-self-${sourceHash.slice(0, 12)}`,
    issuer: "candidate-self",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SELF_ISSUED_TTL_MS).toISOString(),
    sourceHash,
    projectionHash,
    fromSchemaVersion,
    toSchemaVersion,
    hostIdentity,
    promoterDigest,
  };
  return { envelope, signature: signTransitionPayload(envelope, secret) };
}

/** Verify the bounded readiness-to-promotion install-state handoff. */
export function verifyInstallStateMigrationEnvelope(envelope, signature, secret, expected) {
  verifyTransitionSignature(envelope, signature, secret);
  if (envelope.kind !== "install-state-migration" || envelope.version !== 1) throw new Error("install_state_envelope_invalid");
  if (!/^[a-f0-9]{64}$/.test(envelope.sourceHash ?? "") || !/^[a-f0-9]{64}$/.test(envelope.projectionHash ?? "")) throw new Error("install_state_envelope_invalid_hash");
  if (!Number.isInteger(envelope.fromSchemaVersion) || envelope.fromSchemaVersion < 1 || !Number.isInteger(envelope.toSchemaVersion) || envelope.toSchemaVersion < 1) throw new Error("install_state_envelope_invalid_schema");
  const identity = envelope.hostIdentity;
  if (!identity || !["win32", "darwin", "linux"].includes(identity.platform) || !["amd64", "arm64", "x86_64"].includes(identity.arch) || !HOST_IDENTITY_PROVENANCE.includes(identity.provenance)) throw new Error("install_state_envelope_invalid_identity");
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

/**
 * Build the envelope for a caller that never sent one. Recomputes the same
 * projection readiness produced, from the state the promoter already mounts.
 */
async function selfIssueFromMountedState({ stateBytes, sourceHash, secret, now }) {
  const here = new URL("./", import.meta.url);
  const { resolveHostIdentity } = await import(new URL("../installer/resolve-host-identity.mjs", here).href);
  const { projectInstallState } = await import(new URL("../installer/migrate-install-state.mjs", here).href);
  const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", here), "utf8"));

  const state = JSON.parse(stateBytes.toString("utf8").replace(/^﻿/, ""));
  const hostIdentity = resolveHostIdentity({ state, env: process.env });
  const projection = await projectInstallState({ bytes: stateBytes, hostIdentity, catalog });

  return issueSelfSignedMigrationEnvelope({
    secret,
    // The deployed caller does not send DPF_PROMOTER_DIGEST either; the target
    // SHA identifies the candidate just as well when issuer and verifier are
    // the same container.
    promoterDigest: process.env.DPF_PROMOTER_DIGEST ?? `target-sha:${process.env.PROMOTE_TARGET_SHA ?? "unknown"}`,
    now,
    sourceHash,
    projectionHash: projection.projectionHash,
    fromSchemaVersion: state.schemaVersion ?? 1,
    toSchemaVersion: projection.projectedState.schemaVersion,
    hostIdentity: { platform: hostIdentity.platform, arch: hostIdentity.arch, provenance: hostIdentity.provenance },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const secret = (await readFile(process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE ?? "/run/secrets/dpf-runtime-transition", "utf8")).trim();
    const stateBytes = await readFile(`${process.env.DPF_PROMOTER_STATE_DIR ?? "/dpf-state"}/install-state.json`);
    const sourceHash = createHash("sha256").update(stateBytes).digest("hex");
    const now = Date.now();
    const rawEnvelope = process.env.DPF_INSTALL_STATE_MIGRATION_ENVELOPE ?? "";

    // No handoff at all => a caller that predates the protocol (BI-76651B7B).
    // Self-issue rather than refuse, or the install can never be promoted. A
    // HALF handoff is a broken caller, not a legacy one, and still fails.
    const { envelope, signature, expectedRunId } = rawEnvelope
      ? {
          envelope: JSON.parse(Buffer.from(rawEnvelope, "base64url").toString("utf8")),
          signature: process.env.DPF_INSTALL_STATE_MIGRATION_SIGNATURE ?? "",
          expectedRunId: process.env.DPF_SELF_UPGRADE_RUN_ID,
        }
      : await selfIssueFromMountedState({ stateBytes, sourceHash, secret, now })
          .then((issued) => ({ ...issued, expectedRunId: issued.envelope.runId }));

    verifyInstallStateMigrationEnvelope(envelope, signature, secret, {
      runId: expectedRunId,
      promoterDigest: rawEnvelope ? process.env.DPF_PROMOTER_DIGEST : envelope.promoterDigest,
      sourceHash,
      now,
    });
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "install_state_envelope_invalid"}\n`);
    process.exitCode = 78;
  }
}
