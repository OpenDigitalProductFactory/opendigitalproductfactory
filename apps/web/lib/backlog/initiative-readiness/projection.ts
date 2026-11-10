import { validInitiativeGateReceipt } from "./receipt-validation";
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

function projectPayload(
  payload: unknown,
  row: InitiativeGateActivityRow,
  expectedArtifactDigest: string,
): ReadinessEvidenceState {
  if (!validInitiativeGateReceipt(payload, { receiptId: row.id, gate: row.gateKey })) return "malformed";
  const candidate = payload as Record<string, unknown>;
  // This reader historically accepts only the canonical persisted gate name.
  if (candidate.gate !== row.gateKey) return "malformed";
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
