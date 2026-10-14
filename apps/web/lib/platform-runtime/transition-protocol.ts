import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalTransitionPayload, signTransitionPayload, prepareRuntimeReconciliationIntent as prepareSharedReconciliationIntent } from "../../../../scripts/lib/transition-signing.mjs";
export { canonicalTransitionPayload, signTransitionPayload } from "../../../../scripts/lib/transition-signing.mjs";

export const RUNTIME_TRANSITION_MAX_AGE_MS = 10 * 60 * 1000;

export type RuntimeCapabilityProtocolIdentity = {
  sourceSha: string; actuatorSha256: string; signerSha256: string;
};
export type RuntimeCapabilityProtocolInfo = RuntimeCapabilityProtocolIdentity & {
  schemaVersion: 1;
  signingVersions: readonly number[];
  applyVersions: readonly number[];
  reconciliationVersions: readonly number[];
  validatedSnapshotSha256?: string;
};

export type RuntimeReconciliationIntent = {
  observedHost: {
    schemaVersion: number; installerVersion: string; platform: string; arch: string;
    capabilityCatalogHash: string; capabilityStateVersion: string;
    enabledRuntimeCapabilities: readonly string[];
  };
  observedDatabaseStates: Readonly<Record<string, string>>;
  desiredHostEnabledKeys: readonly string[];
  desiredDatabaseStates: Readonly<Record<string, string>>;
  touchedKeys: readonly string[];
};

/** Shared runtime-neutral validation grants no apply authority. */
export function prepareRuntimeReconciliationIntent(
  input: RuntimeReconciliationIntent,
  catalog: { catalogHash: string; capabilityIds: readonly string[] },
): RuntimeReconciliationIntent & { residualDriftKeys: readonly string[] } {
  return prepareSharedReconciliationIntent(input, catalog);
}

/** Discovery is evidence only when it matches the trusted packaged bytes. */
export function validateRuntimeCapabilityProtocolInfo(value: unknown, expected: RuntimeCapabilityProtocolIdentity): RuntimeCapabilityProtocolInfo {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const signing = record.signingVersions, applying = record.applyVersions, reconciliation = record.reconciliationVersions;
  const versions = (entry: unknown): entry is number[] => Array.isArray(entry) && entry.length <= 2
    && entry.every((version, index) => (version === 1 || version === 2) && (index === 0 || entry[index - 1] < version));
  if (record.schemaVersion !== 1 || typeof record.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(record.sourceSha)
      || ![record.actuatorSha256, record.signerSha256].every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))
      || !versions(signing) || !versions(applying) || !versions(reconciliation)
      || applying.some((version) => !signing.includes(version))
      || reconciliation.some((version) => !applying.includes(version))) {
    throw new Error("runtime_protocol_probe_invalid");
  }
  for (const key of ["sourceSha", "actuatorSha256", "signerSha256"] as const) {
    if (record[key] !== expected[key]) throw new Error("runtime_protocol_probe_identity_mismatch");
  }
  if (record.validatedSnapshotSha256 !== undefined && (typeof record.validatedSnapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.validatedSnapshotSha256))) throw new Error("runtime_protocol_probe_invalid");
  return { schemaVersion: 1, ...expected, signingVersions: [...signing], applyVersions: [...applying], reconciliationVersions: [...reconciliation],
    ...(typeof record.validatedSnapshotSha256 === "string" ? { validatedSnapshotSha256: record.validatedSnapshotSha256 } : {}),
  };
}

type RuntimeTransitionEnvelopeFields = {
  protocolIdentity?: RuntimeCapabilityProtocolIdentity & { promoterDigest: string };
  transitionId: string; issuedAt: string; expiresAt: string;
  catalogHash: string; previousStateHash: string; desiredStateHash: string;
  previousKeys: string[]; desiredKeys: string[];
  previousProfiles: string[]; desiredProfiles: string[];
  previousServices: string[]; desiredServices: string[];
};

export type RuntimeTransitionEnvelope = RuntimeTransitionEnvelopeFields & (
  | { version: 1 }
  | { version: 2; kind: "runtime-capability-transition"; mode: "transition" }
  | { version: 2; kind: "runtime-capability-transition"; mode: "reconciliation"; reconciliation: RuntimeReconciliationIntent }
);

/** Compensation keeps one source-bound identity; persist this packet before IO. */
export function createRuntimeCompensationEnvelope(envelope: RuntimeTransitionEnvelope, now: number): RuntimeTransitionEnvelope {
  return {
    ...structuredClone(envelope), transitionId: `RCT-${createHash("sha256").update(envelope.transitionId).digest("hex").slice(0, 24)}-rb`,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + RUNTIME_TRANSITION_MAX_AGE_MS).toISOString(),
    previousKeys: [...envelope.desiredKeys], desiredKeys: [...envelope.previousKeys],
    previousStateHash: envelope.desiredStateHash, desiredStateHash: envelope.previousStateHash,
    previousProfiles: [...envelope.desiredProfiles], desiredProfiles: [...envelope.previousProfiles],
    previousServices: [...envelope.desiredServices], desiredServices: [...envelope.previousServices],
    ...(envelope.version === 2 && envelope.mode === "reconciliation" ? { reconciliation: {
      observedHost: { ...structuredClone(envelope.reconciliation.observedHost), enabledRuntimeCapabilities: [...envelope.desiredKeys], capabilityStateVersion: envelope.desiredStateHash },
      observedDatabaseStates: { ...envelope.reconciliation.desiredDatabaseStates }, desiredHostEnabledKeys: [...envelope.previousKeys],
      desiredDatabaseStates: { ...envelope.reconciliation.observedDatabaseStates }, touchedKeys: [...envelope.reconciliation.touchedKeys],
    } } : {}),
  };
}

export type RuntimeCompensationPacket = { envelope: RuntimeTransitionEnvelope; envelopeSignature: string };

export type RuntimeTransitionReceipt = RuntimeTransitionEnvelope & {
  status: "applied" | "failed" | "rolled_back" | "rollback_failed"; observedServices: string[]; completedAt: string;
  /** Compose health captured by the host boundary. `none` means the service
   * has no container healthcheck; it is not a synonym for healthy. */
  observedHealth?: Record<string, "healthy" | "unhealthy" | "starting" | "none">;
  beforeHash: string; afterHash: string; failure?: string; signature: string;
};

function verifySignedReceipt(receipt: RuntimeTransitionReceipt, secret: string, envelope: RuntimeTransitionEnvelope): void {
  const { signature, ...unsigned } = receipt;
  const expected = signTransitionPayload(unsigned, secret);
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("runtime_transition_receipt_tampered");
  if (envelope.version === 2 && envelope.mode !== "transition"
    && !(envelope.mode === "reconciliation" && envelope.reconciliation)) throw new Error("unsupported_runtime_transition_mode");
  if (envelope.version === 2 && (receipt.version !== 2 || receipt.kind !== envelope.kind || receipt.mode !== envelope.mode)) {
    throw new Error("runtime_transition_receipt_mismatch");
  }
  if (envelope.version === 2 && canonicalTransitionPayload(envelope)
    !== canonicalTransitionPayload(Object.fromEntries(Object.keys(envelope).map(key => [key, unsigned[key as keyof typeof unsigned]])))) {
    throw new Error("runtime_transition_receipt_mismatch");
  }
  for (const key of ["version", "transitionId", "issuedAt", "expiresAt", "catalogHash", "previousStateHash", "desiredStateHash", "previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles", "previousServices", "desiredServices"] as const) {
    if (JSON.stringify(receipt[key]) !== JSON.stringify(envelope[key])) throw new Error("runtime_transition_receipt_mismatch");
  }
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  const completedAt = Date.parse(receipt.completedAt);
  if (![issuedAt, expiresAt, completedAt].every(Number.isFinite) || completedAt < issuedAt || completedAt > expiresAt) throw new Error("runtime_transition_receipt_time_invalid");
  if (receipt.status === "applied") {
    if (receipt.beforeHash !== envelope.previousStateHash || receipt.afterHash !== envelope.desiredStateHash) throw new Error("runtime_transition_host_apply_failed");
  } else if (receipt.status === "failed" || receipt.status === "rolled_back" || receipt.status === "rollback_failed") {
    if (receipt.beforeHash !== envelope.previousStateHash || receipt.afterHash !== envelope.previousStateHash) throw new Error("runtime_transition_failure_receipt_mismatch");
  } else throw new Error("runtime_transition_receipt_status_invalid");
}

/** Live-path verification also requires that the launch authority is current. */
export function verifyLiveTransitionReceipt(receipt: RuntimeTransitionReceipt, secret: string, envelope: RuntimeTransitionEnvelope, now = Date.now()): RuntimeTransitionReceipt["status"] {
  verifySignedReceipt(receipt, secret, envelope);
  if (Date.parse(receipt.expiresAt) < now || Date.parse(receipt.issuedAt) > now + 30_000) throw new Error("runtime_transition_receipt_expired");
  return receipt.status;
}

/** Recovery verifies durable history, not whether its launch window is still open. */
export function verifyHistoricalTransitionReceipt(receipt: RuntimeTransitionReceipt, secret: string, envelope: RuntimeTransitionEnvelope): RuntimeTransitionReceipt["status"] {
  verifySignedReceipt(receipt, secret, envelope);
  return receipt.status;
}

export const verifyTransitionReceipt = verifyLiveTransitionReceipt;
