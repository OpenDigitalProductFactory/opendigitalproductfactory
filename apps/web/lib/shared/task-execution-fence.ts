import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "./coerce";
import { hasExecutionUncertainty } from "./execution-uncertainty";

/** Captured by the admitted executor, never reconstructed for a callback. */
export type TaskExecutionFence = {
  schemaVersion: 1;
  reservation: string | null;
  dispatchClaim: string | null;
  authorityDigest: string | null;
  requestDigest: string | null;
};

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function reservationIdentity(progress: unknown): string | null {
  return isRecord(progress) ? optionalString(progress.resumeReservedAt) : null;
}

export function dispatchIdentity(progress: unknown): string | null {
  return isRecord(progress) && isRecord(progress.dispatch) ? optionalString(progress.dispatch.claimedAt) : null;
}

const nullableIdentity = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length > 0 && value.length <= 1024 && value.trim() === value);

export function parseTaskExecutionFence(value: unknown): TaskExecutionFence | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).length !== 5
    || !nullableIdentity(value.reservation) || !nullableIdentity(value.dispatchClaim)
    || !nullableDigest(value.authorityDigest) || !nullableDigest(value.requestDigest)) return null;
  return { schemaVersion: 1, reservation: value.reservation, dispatchClaim: value.dispatchClaim, authorityDigest: value.authorityDigest, requestDigest: value.requestDigest };
}

const nullableDigest = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));

/** null progress is an admitted initial generation; absence of a signed fence is not. */
export function captureTaskExecutionFence(progress: unknown, requestDigest: unknown = null): TaskExecutionFence | null {
  if (!nullableDigest(requestDigest)) return null;
  if (progress !== null && progress !== undefined && !isRecord(progress)) return null;
  const row = isRecord(progress) ? progress : {};
  if (row.resumeReservedAt != null && !nullableIdentity(row.resumeReservedAt)) return null;
  if (row.dispatch != null && !isRecord(row.dispatch)) return null;
  if (isRecord(row.dispatch) && row.dispatch.claimedAt != null && !nullableIdentity(row.dispatch.claimedAt)) return null;
  const authority = row.reviewExecutionAuthority;
  if (authority != null && (!isRecord(authority) || authority.schemaVersion !== 1)) return null;
  return { schemaVersion: 1, reservation: reservationIdentity(row), dispatchClaim: dispatchIdentity(row),
    authorityDigest: authority == null ? null : createHash("sha256").update(canonicalJson(authority)).digest("hex"), requestDigest };
}

export function sameTaskExecutionFence(left: unknown, right: unknown): boolean {
  const a = parseTaskExecutionFence(left), b = parseTaskExecutionFence(right);
  return Boolean(a && b && a.reservation === b.reservation && a.dispatchClaim === b.dispatchClaim && a.authorityDigest === b.authorityDigest && a.requestDigest === b.requestDigest);
}

/** submitRemoteCoworkerTask persists null for ordinary nonreview tasks. Only
 * that historical absence sentinel and a missing property are unbound;
 * malformed present values must still enter the fail-closed review guard. */
export function isBoundReviewTask(metadata: unknown): boolean {
  return isRecord(metadata) && Object.prototype.hasOwnProperty.call(metadata, "initiativeReviewBinding")
    && metadata.initiativeReviewBinding !== null;
}

/** A parked approval retains its original executor identity; it never borrows
 * the current generation. The caller separately proves the exact approval. */
export function taskExecutionEligible(input: {
  status: string; progressPayload: unknown; requestDigest: unknown; executionFence: unknown;
  phase?: "working" | "approval-resume" | "approval-renewal";
}): boolean {
  const states = input.phase === "approval-renewal" ? ["working", "input-required", "stalled", "failed"]
    : input.phase === "approval-resume" ? ["working", "input-required"] : ["working"];
  return states.includes(input.status) && typeof input.requestDigest === "string"
    && !(isRecord(input.progressPayload) && Object.hasOwn(input.progressPayload, "reassessmentQuarantine"))
    && /^[a-f0-9]{64}$/.test(input.requestDigest) && !hasExecutionUncertainty(input.progressPayload)
    && sameTaskExecutionFence(input.executionFence, captureTaskExecutionFence(input.progressPayload, input.requestDigest));
}
