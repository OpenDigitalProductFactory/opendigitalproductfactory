import { parseInitiativeReviewArtifactRef, type InitiativeReviewArtifactRef } from "@/lib/mcp-task-review-contract";
import { validateInitiativeBaselineChainHead } from "./baseline-repository";

export type BaselinePayload = Record<string, unknown> & {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactRef?: InitiativeReviewArtifactRef;
};

export function parseBaselinePayloads(payloads: unknown[]): BaselinePayload[] | null {
  const rows: BaselinePayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")) return null;
    const artifactRef = parseInitiativeReviewArtifactRef(row.artifactRef) ?? undefined;
    rows.push({ ...row, baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      ...(artifactRef ? { artifactRef } : {}) });
  }
  return rows;
}

export function currentBaseline(rows: BaselinePayload[]): BaselinePayload | null {
  const superseded = new Set(rows.map((row) => row.supersedesBaselineId).filter((id): id is string => Boolean(id)));
  const heads = rows.filter((row) => !superseded.has(row.baselineId));
  if (heads.length !== 1) return null;
  const expected = heads[0]!.baselineId;
  const validation = validateInitiativeBaselineChainHead(rows, expected);
  return validation.ok ? heads[0]! : null;
}
