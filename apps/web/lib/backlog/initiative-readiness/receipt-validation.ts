import { INITIATIVE_GATE_KEYS } from "./receipt-schema";
import { READINESS_PROFILES } from "./types";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function validString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

function validArtifactRef(input: unknown): boolean {
  const value = object(input);
  if (!value) return false;
  if (value.kind === "feature-build-revision") return validString(value.revisionId);
  if (value.kind === "document-version") return validString(value.versionId);
  return value.kind === "repo-blob-at-commit"
    && validString(value.repositoryFullName) && validString(value.commitSha)
    && validString(value.path) && validString(value.providerBlobId);
}

export function validAuthoritySnapshot(input: unknown): boolean {
  const value = object(input);
  return value?.decision === "allow"
    && validString(value.effectiveHumanCapability) && validString(value.effectiveAgentGrant)
    && validString(value.tokenScope) && validString(value.organizationId)
    && validString(value.actionKey) && validString(value.policyVersion);
}

export function normalizeInitiativeGate(value: string | null): string | null {
  return value?.replaceAll("_", "-") ?? null;
}

/** Validate persisted evidence before either readiness or a read projection uses it.
 * Subject matching is explicit: row database IDs are not semantic subject IDs.
 * Digest freshness remains the caller's version-aware policy.
 */
export function validInitiativeGateReceipt(
  input: unknown,
  expected: { receiptId: string; gate: string; subject?: { kind: string; id: string } },
): boolean {
  const payload = object(input);
  if (!payload) return false;
  const subject = object(payload.subject);
  const gate = normalizeInitiativeGate(typeof payload.gate === "string" ? payload.gate : null);
  return payload.schemaVersion === 1
    && payload.receiptId === expected.receiptId
    && gate === expected.gate
    && (INITIATIVE_GATE_KEYS as readonly string[]).includes(expected.gate)
    && ["pass", "fail", "not-applicable"].includes(String(payload.decision))
    && validString(payload.policyVersion) && validString(payload.artifactDigest)
    && validString(payload.artifactAuthorRef) && validString(payload.reviewerPrincipalId)
    && validString(payload.reviewerAgentId) && validString(payload.authorityDecisionId)
    && validString(payload.reason)
    && Boolean(subject && ["backlog-item", "epic", "feature-build", "task-run"].includes(String(subject.kind)))
    && validString(subject?.id)
    && (!expected.subject || (subject?.kind === expected.subject.kind && subject.id === expected.subject.id))
    && validArtifactRef(payload.artifactRef) && validAuthoritySnapshot(payload.authoritySnapshot)
    && validStringArray(payload.findingRefs) && validStringArray(payload.resolvedFindingRefs)
    && (gate !== "classification" || payload.decision !== "pass"
      || (READINESS_PROFILES as readonly string[]).includes(String(payload.selectedProfile)))
    && (gate === "classification" || payload.selectedProfile === undefined)
    && (payload.decision === "fail" || payload.findingRefs.length === 0);
}
