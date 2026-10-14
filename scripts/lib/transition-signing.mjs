import { createHmac, timingSafeEqual } from "node:crypto";
import { computeCapabilityStateVersion } from "./capability-state-hash.mjs";

/** Version 1 bytes remain readable; version 2 binds every nested member. */
export function canonicalTransitionPayload(value) {
  if (value?.version === 2) {
    if (value.kind !== "runtime-capability-transition") throw new Error("unsupported_runtime_transition_kind");
    return recursiveCanonicalJson(value);
  }
  if (value?.kind === "install-state-migration") return recursiveCanonicalJson(value);
  if (value?.kind === "runtime-capability-transition") {
    if (value.version !== 1 && value.version !== 2) throw new Error("unsupported_runtime_transition_version");
  }
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

/** Validate immutable dual baselines in the portal and packaged host alike.
 * @param {any} input
 * @param {{catalogHash: string, capabilityIds: readonly string[]}} catalog
 */
export function prepareRuntimeReconciliationIntent(input, catalog) {
  const known = new Set(catalog.capabilityIds);
  const keysValid = (keys) => Array.isArray(keys)
    && keys.every(key => typeof key === "string" && known.has(key)) && new Set(keys).size === keys.length;
  const host = input.observedHost;
  if (!host || !Number.isInteger(host.schemaVersion) || host.schemaVersion < 1
    || typeof host.installerVersion !== "string" || !host.installerVersion.trim()
    || !["darwin", "linux", "win32"].includes(host.platform) || !["arm64", "amd64", "x86_64"].includes(host.arch)
    || host.capabilityCatalogHash !== catalog.catalogHash || !/^[a-f0-9]{64}$/.test(catalog.catalogHash)
    || !keysValid(host.enabledRuntimeCapabilities)
    || JSON.stringify(host.enabledRuntimeCapabilities) !== JSON.stringify([...host.enabledRuntimeCapabilities].sort())
    || host.capabilityStateVersion !== computeCapabilityStateVersion(catalog.catalogHash, host.enabledRuntimeCapabilities, catalog.capabilityIds)) {
    throw new Error("reconciliation_host_baseline_invalid");
  }
  if (!keysValid(input.touchedKeys)) throw new Error("reconciliation_touched_keys_invalid");
  if (!keysValid(input.desiredHostEnabledKeys)) throw new Error("reconciliation_desired_host_invalid");
  const mapValid = (states) => states && typeof states === "object" && !Array.isArray(states)
    && Object.keys(states).length === known.size && Object.keys(states).every(key => known.has(key))
    && catalog.capabilityIds.every(key => Object.hasOwn(states, key) && typeof states[key] === "string");
  if (!mapValid(input.observedDatabaseStates) || !mapValid(input.desiredDatabaseStates)) {
    throw new Error("reconciliation_database_map_invalid");
  }
  const touched = new Set(input.touchedKeys);
  for (const key of catalog.capabilityIds) {
    if (!touched.has(key) && input.observedDatabaseStates[key] !== input.desiredDatabaseStates[key]) {
      throw new Error("reconciliation_untouched_state_changed");
    }
    if (touched.has(key) && ![input.observedDatabaseStates[key], input.desiredDatabaseStates[key]]
      .every(state => state === "active" || state === "disabled")) throw new Error("reconciliation_managed_state_invalid");
  }
  return {
    observedHost: { ...structuredClone(host), enabledRuntimeCapabilities: [...host.enabledRuntimeCapabilities] },
    observedDatabaseStates: { ...input.observedDatabaseStates },
    desiredHostEnabledKeys: [...input.desiredHostEnabledKeys].sort(),
    desiredDatabaseStates: { ...input.desiredDatabaseStates },
    touchedKeys: [...input.touchedKeys].sort(),
    residualDriftKeys: catalog.capabilityIds.filter(key => input.desiredDatabaseStates[key]
      !== (input.desiredHostEnabledKeys.includes(key) ? "active" : "disabled")).sort(),
  };
}
