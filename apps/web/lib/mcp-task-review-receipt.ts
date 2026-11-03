import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

export const REVIEW_RECEIPT_DECISIONS = ["pass", "fail", "inconclusive", "not-applicable"] as const;
export type ReviewReceiptDecision = (typeof REVIEW_RECEIPT_DECISIONS)[number];

/** The keys that name an immutable artifact. A receipt may omit the others. */
export const ARTIFACT_IDENTITY_KEYS: Record<InitiativeReviewBinding["artifactRef"]["kind"], readonly string[]> = {
  "repo-blob-at-commit": ["kind", "commitSha", "path", "providerBlobId"],
  "feature-build-revision": ["kind", "revisionId"],
  "document-version": ["kind", "versionId"],
  // BI-46E344FE: the digest names the change; the ranges name where it was read.
  "repo-commit-range": ["kind", "repositoryFullName", "ranges", "digest"],
};

/** Range lists are compared by value; every other identity field is a string. */
const sameIdentityValue = (left: unknown, right: unknown) => left === right
  || (Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right));

/**
 * A receipt matches its binding when every identity key is equal and no key
 * the receipt does store contradicts the binding. Revision and document receipts keep
 * only kind + their version id, while the binding also carries
 * repositoryFullName and valueDigest (BI-2E479619).
 */
export function receiptArtifactMatches(bound: InitiativeReviewBinding["artifactRef"], stored: Record<string, unknown>): boolean {
  const boundFields = bound as Record<string, unknown>;
  const identity = ARTIFACT_IDENTITY_KEYS[bound.kind] ?? Object.keys(boundFields);
  if (identity.some((key) => !sameIdentityValue(stored[key], boundFields[key]))) return false;
  return Object.entries(boundFields).every(([key, value]) => !(key in stored) || sameIdentityValue(stored[key], value));
}
