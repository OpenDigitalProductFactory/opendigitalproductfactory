import { isRecord } from "@/lib/shared/coerce";

export const SEMANTIC_REVIEW_REMEDIATION_MAX_AGE_MS = 30 * 60_000;

type Verification = {
  kind: string; status: string; workCapsuleId: string | null;
  runtimeTargetId: string | null; command: string | null;
  completedAt: Date | null; result: unknown;
};

/** Shared read/admission predicate. A valid observation does not authorize a retry. */
export function readSemanticReviewRemediation(
  verification: Verification | null,
  binding: { capsuleId: string; taskRunId: string; requestDigest: string; updatedAt: Date },
  now = Date.now(),
): { settledNodeIds: string[]; observation: string; eligibilityVerified: boolean } | null {
  const proof = isRecord(verification?.result) && isRecord(verification.result.semanticReviewRecovery)
    ? verification.result.semanticReviewRecovery : null;
  const completed = verification?.completedAt?.getTime() ?? NaN;
  if (!verification || verification.kind !== "health" || verification.status !== "passed"
    || verification.workCapsuleId !== binding.capsuleId || !verification.runtimeTargetId || !verification.command?.trim()
    || !Number.isFinite(completed) || completed < binding.updatedAt.getTime() || completed > now
    || now - completed > SEMANTIC_REVIEW_REMEDIATION_MAX_AGE_MS
    || proof?.taskRunId !== binding.taskRunId || proof.requestDigest !== binding.requestDigest
    || proof.executionSettled !== true || typeof proof.observation !== "string" || !proof.observation.trim()
    || !Array.isArray(proof.settledNodeIds) || proof.settledNodeIds.some(id => typeof id !== "string")) return null;
  return { settledNodeIds: proof.settledNodeIds as string[], observation: proof.observation,
    eligibilityVerified: proof.eligibilityVerified === true };
}
