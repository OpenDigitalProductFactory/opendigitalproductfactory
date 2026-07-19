import { timingSafeEqual } from "node:crypto";
import { signTransitionPayload } from "../../../../scripts/lib/transition-signing.mjs";
export { canonicalTransitionPayload, signTransitionPayload } from "../../../../scripts/lib/transition-signing.mjs";

export const RUNTIME_TRANSITION_MAX_AGE_MS = 10 * 60 * 1000;

export type RuntimeTransitionEnvelope = {
  version: 1; transitionId: string; issuedAt: string; expiresAt: string;
  catalogHash: string; previousStateHash: string; desiredStateHash: string;
  previousKeys: string[]; desiredKeys: string[];
  previousProfiles: string[]; desiredProfiles: string[];
  previousServices: string[]; desiredServices: string[];
};

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
