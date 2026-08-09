import type { ReadinessEvidenceState } from "./types";
import type { InitiativeGateKey } from "./receipt-schema";
import {
  selectLatestInitiativeGateRows,
  type InitiativeGateActivityRow,
} from "./receipt-reader";

export type InitiativeGateProjection = {
  backlogItemId: string;
  gate: InitiativeGateKey;
  state: ReadinessEvidenceState;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function validSubject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const subject = value as Record<string, unknown>;
  return (["backlog-item", "epic", "feature-build", "task-run"] as const).includes(subject.kind as never)
    && nonEmptyString(subject.id);
}

function validArtifactRef(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  if (ref.kind === "feature-build-revision") return nonEmptyString(ref.revisionId);
  if (ref.kind === "document-version") return nonEmptyString(ref.versionId);
  return ref.kind === "repo-blob-at-commit"
    && nonEmptyString(ref.repositoryFullName)
    && nonEmptyString(ref.commitSha)
    && nonEmptyString(ref.path)
    && nonEmptyString(ref.providerBlobId);
}

function validAuthoritySnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const authority = value as Record<string, unknown>;
  return authority.decision === "allow"
    && nonEmptyString(authority.effectiveHumanCapability)
    && nonEmptyString(authority.effectiveAgentGrant)
    && nonEmptyString(authority.tokenScope)
    && nonEmptyString(authority.organizationId)
    && nonEmptyString(authority.actionKey)
    && nonEmptyString(authority.policyVersion);
}

function projectPayload(
  payload: unknown,
  row: InitiativeGateActivityRow,
  expectedArtifactDigest: string,
): ReadinessEvidenceState {
  if (!payload || typeof payload !== "object") return "malformed";
  const candidate = payload as Record<string, unknown>;
  const validProfiles = ["doc-only", "fix", "feature", "cross-domain", "archetype"] as const;
  if (candidate.schemaVersion !== 1
    || !(["pass", "fail", "not-applicable"] as const).includes(candidate.decision as never)
    || candidate.receiptId !== row.id
    || candidate.gate !== row.gateKey
    || !nonEmptyString(candidate.artifactDigest)
    || !nonEmptyString(candidate.artifactAuthorRef)
    || !nonEmptyString(candidate.reviewerPrincipalId)
    || !nonEmptyString(candidate.reviewerAgentId)
    || !nonEmptyString(candidate.authorityDecisionId)
    || !nonEmptyString(candidate.reason)
    || !validSubject(candidate.subject)
    || !validArtifactRef(candidate.artifactRef)
    || !stringArray(candidate.findingRefs)
    || !stringArray(candidate.resolvedFindingRefs)
    || !validAuthoritySnapshot(candidate.authoritySnapshot)
    || (row.gateKey === "classification" && candidate.decision === "pass" && !validProfiles.includes(candidate.selectedProfile as never))
    || (row.gateKey !== "classification" && candidate.selectedProfile !== undefined)
    || (candidate.decision !== "fail" && candidate.findingRefs.length > 0)) {
    return "malformed";
  }
  if (candidate.artifactDigest !== expectedArtifactDigest) return "stale";
  return candidate.decision as "pass" | "fail" | "not-applicable";
}

export function projectInitiativeGateEvidence(
  rows: InitiativeGateActivityRow[],
  options: { itemIds: readonly string[]; expectedArtifactDigest: string },
): InitiativeGateProjection[] {
  return selectLatestInitiativeGateRows(rows, options.itemIds).map((row) => ({
    backlogItemId: row.backlogItemId,
    gate: row.gateKey,
    state: projectPayload(row.payload, row, options.expectedArtifactDigest),
  }));
}
