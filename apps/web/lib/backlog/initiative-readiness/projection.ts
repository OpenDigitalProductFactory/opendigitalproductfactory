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

function projectPayload(
  payload: unknown,
  row: InitiativeGateActivityRow,
  expectedArtifactDigest: string,
): ReadinessEvidenceState {
  if (!payload || typeof payload !== "object") return "malformed";
  const candidate = payload as Record<string, unknown>;
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
    || !stringArray(candidate.findingRefs)
    || !stringArray(candidate.resolvedFindingRefs)
    || !candidate.authoritySnapshot
    || typeof candidate.authoritySnapshot !== "object"
    || (candidate.authoritySnapshot as Record<string, unknown>).decision !== "allow"
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
