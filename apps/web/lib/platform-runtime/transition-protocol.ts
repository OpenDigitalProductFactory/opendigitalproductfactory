import { createHmac, timingSafeEqual } from "node:crypto";

export const RUNTIME_TRANSITION_MAX_AGE_MS = 10 * 60 * 1000;

export type RuntimeTransitionEnvelope = {
  version: 1; transitionId: string; issuedAt: string; expiresAt: string;
  catalogHash: string; previousStateHash: string; desiredStateHash: string;
  previousKeys: string[]; desiredKeys: string[];
  previousProfiles: string[]; desiredProfiles: string[];
};

export type RuntimeTransitionReceipt = RuntimeTransitionEnvelope & {
  status: "applied" | "failed" | "rollback_failed"; observedServices: string[]; completedAt: string;
  beforeHash: string; afterHash: string; failure?: string; signature: string;
};

export function canonicalTransitionPayload(value: Omit<RuntimeTransitionReceipt, "signature"> | RuntimeTransitionEnvelope): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function signTransitionPayload(value: Omit<RuntimeTransitionReceipt, "signature"> | RuntimeTransitionEnvelope, secret: string): string {
  if (secret.length < 32) throw new Error("runtime_transition_secret_too_short");
  return createHmac("sha256", secret).update(canonicalTransitionPayload(value)).digest("hex");
}

export function verifyTransitionReceipt(receipt: RuntimeTransitionReceipt, secret: string, envelope: RuntimeTransitionEnvelope, now = Date.now()): void {
  const { signature, ...unsigned } = receipt;
  const expected = signTransitionPayload(unsigned, secret);
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("runtime_transition_receipt_tampered");
  for (const key of ["version", "transitionId", "issuedAt", "expiresAt", "catalogHash", "previousStateHash", "desiredStateHash", "previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles"] as const) {
    if (JSON.stringify(receipt[key]) !== JSON.stringify(envelope[key])) throw new Error("runtime_transition_receipt_mismatch");
  }
  if (Date.parse(receipt.expiresAt) < now || Date.parse(receipt.issuedAt) > now + 30_000) throw new Error("runtime_transition_receipt_expired");
  if (receipt.status !== "applied" || receipt.beforeHash !== envelope.previousStateHash || receipt.afterHash !== envelope.desiredStateHash) throw new Error("runtime_transition_host_apply_failed");
}
