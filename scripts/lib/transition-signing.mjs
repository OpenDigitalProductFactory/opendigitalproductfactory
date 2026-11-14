import { createHmac, timingSafeEqual } from "node:crypto";
import { computeCapabilityStateVersion } from "./capability-state-hash.mjs";

/** Version 1 bytes remain readable; versions 2 and 3 bind every nested member. */
export function canonicalTransitionPayload(value) {
  if (value?.version === 2 || value?.version === 3) {
    if (value.kind !== "runtime-capability-transition") throw new Error("unsupported_runtime_transition_kind");
    return recursiveCanonicalJson(value);
  }
  if (value?.kind === "install-state-migration") return recursiveCanonicalJson(value);
  if (value?.kind === "runtime-capability-transition") {
    if (value.version !== 1) throw new Error("unsupported_runtime_transition_version");
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

const immutableImageId = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const objectRecord = value => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => objectRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameCanonical = (left, right) => recursiveCanonicalJson(left) === recursiveCanonicalJson(right);

/** Image-only reconciliation cannot carry an activation or saved-state change.
 * This validator is shared with the already packaged actuator/signer closure. */
export function validateRuntimeServiceImagePlan(envelope) {
  const invalid = () => { throw new Error("runtime_image_plan_invalid"); };
  const plan = envelope?.imagePlan, intent = envelope?.reconciliation;
  if (envelope?.version !== 3 || envelope.kind !== "runtime-capability-transition" || envelope.mode !== "reconciliation"
    || !exactKeys(plan, ["schemaVersion", "sourceSha", "platform", "operation", "services"])
    || plan.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(plan.sourceSha ?? "")
    || plan.sourceSha !== envelope.protocolIdentity?.sourceSha || !["prepare", "restore"].includes(plan.operation)
    || !/^[a-f0-9]{64}$/.test(envelope.protocolIdentity?.imageQualifierSha256 ?? "")
    || !["linux/amd64", "linux/arm64"].includes(plan.platform)
    || !intent || !Array.isArray(intent.touchedKeys) || intent.touchedKeys.length !== 0
    || !objectRecord(intent.observedDatabaseStates) || Object.keys(intent.observedDatabaseStates).length === 0
    || !objectRecord(intent.desiredDatabaseStates)
    || !Array.isArray(intent.observedHost?.enabledRuntimeCapabilities)
    || !sameCanonical(intent.observedHost.enabledRuntimeCapabilities, envelope.previousKeys)
    || !sameCanonical(intent.observedDatabaseStates, intent.desiredDatabaseStates)
    || !sameCanonical(intent.observedHost?.enabledRuntimeCapabilities, intent.desiredHostEnabledKeys)
    || !["Keys", "Profiles", "Services"].every(member => Array.isArray(envelope[`previous${member}`])
      && sameCanonical(envelope[`previous${member}`], envelope[`desired${member}`]))
    || envelope.previousStateHash !== envelope.desiredStateHash
    || !Array.isArray(plan.services) || plan.services.length !== 1) invalid();
  const arch = intent.observedHost?.arch;
  if (plan.platform !== `linux/${arch === "x86_64" ? "amd64" : arch}`) invalid();
  for (const entry of plan.services) {
    // First bounded image recipe: the existing browser service. Other service
    // classes and contexts remain unsupported rather than becoming build input.
    if (!exactKeys(entry, ["service", "source"]) || entry.service !== "browser-use"
      || !envelope.previousServices.includes(entry.service)) invalid();
    const source = entry.source;
    if (plan.operation === "restore") {
      if (!exactKeys(source, ["kind", "imageId", "expectedImageId"]) || source.kind !== "restore"
        || !immutableImageId(source.imageId) || !immutableImageId(source.expectedImageId)) invalid();
    } else if (source?.kind === "source") {
      if (!exactKeys(source, ["kind", "sourceSha"]) || source.sourceSha !== plan.sourceSha) invalid();
    } else if (source?.kind === "published") {
      if (!exactKeys(source, ["kind", "sourceSha", "reference"]) || source.sourceSha !== plan.sourceSha
        || !/^ghcr\.io\/[A-Za-z0-9][A-Za-z0-9_.-]*\/dpf-browser-use@sha256:[a-f0-9]{64}$/.test(source.reference ?? "")) invalid();
    } else invalid();
  }
  return structuredClone(plan);
}

/** A signed green health result is not evidence of the selected image bytes. */
export function validateRuntimeServiceImageProof(receipt, envelope) {
  const plan = validateRuntimeServiceImagePlan(envelope);
  const invalid = () => { throw new Error("runtime_image_proof_invalid"); };
  const proof = receipt.imageProof;
  // A failure retains unknown observations rather than manufacturing proof.
  if (["failed", "rollback_failed"].includes(receipt.status) && proof === undefined) return;
  if (!exactKeys(proof, ["schemaVersion", "sourceSha", "services", "untouchedBefore", "untouchedAfter"])
    || proof.schemaVersion !== 1 || proof.sourceSha !== plan.sourceSha
    || !Array.isArray(proof.services) || proof.services.length !== plan.services.length) invalid();
  const untouched = envelope.previousServices.filter(service => !plan.services.some(entry => entry.service === service));
  if (!exactKeys(proof.untouchedBefore, untouched) || !exactKeys(proof.untouchedAfter, untouched)
    || untouched.some(service => !/^[a-f0-9]{64}$/.test(proof.untouchedBefore[service] ?? "")
      || proof.untouchedBefore[service] !== proof.untouchedAfter[service])) invalid();
  for (const [index, intended] of plan.services.entries()) {
    const actual = proof.services[index];
    if (!exactKeys(actual, ["service", "priorImageId", "intendedImageId", "observedImageId", "priorContainerId", "observedContainerId", "resourcesBeforeHash", "resourcesAfterHash", "source"])
      || actual.service !== intended.service
      || ![actual.priorImageId, actual.intendedImageId, actual.observedImageId].every(immutableImageId)
      || ![actual.priorContainerId, actual.observedContainerId, actual.resourcesBeforeHash, actual.resourcesAfterHash].every(value => /^[a-f0-9]{64}$/.test(value ?? ""))
      || actual.resourcesBeforeHash !== actual.resourcesAfterHash) invalid();
    if (intended.source.kind === "source") {
      if (!exactKeys(actual.source, ["kind", "sourceSha", "inputTreeOid"])
        || actual.source.kind !== "source" || actual.source.sourceSha !== plan.sourceSha
        || !/^[a-f0-9]{40}$/.test(actual.source.inputTreeOid ?? "")) invalid();
    } else if (!sameCanonical(actual.source, intended.source)) invalid();
    if (intended.source.kind === "restore"
      && (actual.priorImageId !== intended.source.expectedImageId || actual.intendedImageId !== intended.source.imageId)) invalid();
    const expected = receipt.status === "rolled_back" ? actual.priorImageId : actual.intendedImageId;
    if (["applied", "rolled_back"].includes(receipt.status)
      && (actual.observedImageId !== expected || receipt.observedHealth?.[actual.service] !== "healthy")) invalid();
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
