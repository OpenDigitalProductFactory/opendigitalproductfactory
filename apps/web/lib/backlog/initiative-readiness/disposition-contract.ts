/** Shared by reviewer instructions, provider schemas, and receipt validation. */
export const INITIATIVE_DISPOSITION_GUIDANCE =
  "Pass requires findings=[]. Positive observations belong in reason. Resolve only existing open finding IDs; otherwise use resolvedFindingRefs=[]. "
  + "Only fail may introduce findings. Cite the bound immutable artifact's blob and lines for each finding, "
  + "and check that the artifact does not contradict the finding. Never discard a finding to obtain approval. "
  + "A receipt satisfies only its own gate; current readiness determines whether implementation may proceed.";

export function validateInitiativeDisposition(
  decision: string,
  findings: readonly unknown[],
  _resolvedFindingRefs: readonly string[],
): string | null {
  if (decision === "pass" && findings.length > 0) {
    return `A passing receipt requires empty findings. ${INITIATIVE_DISPOSITION_GUIDANCE}`;
  }
  if (decision !== "fail" && findings.length > 0) {
    return "Only a failing receipt can introduce findings. Put positive observations in reason.";
  }
  return null;
}

export const APPROVAL_CORRECTION_ERROR = "supersession-dispositions-invalid";
export type ApprovalCorrection = {
  expectedCurrentBaselineId: string;
  requiredStatementIds: string[];
  missingStatementIds: string[];
};

/** Closed, bounded subset of the canonical writer failure. Not a replay permit. */
export function parseApprovalCorrection(value: unknown): ApprovalCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { expectedCurrentBaselineId, requiredStatementIds, missingStatementIds } = value as Record<string, unknown>;
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 128
    && ids.every(id => typeof id === "string" && /^(?:OBJ|AC)-[A-Z0-9-]{1,96}$/u.test(id))
    && new Set(ids).size === ids.length;
  if (typeof expectedCurrentBaselineId !== "string" || !/^baseline-[A-Za-z0-9-]{1,96}$/u.test(expectedCurrentBaselineId)
    || !validIds(requiredStatementIds) || requiredStatementIds.length === 0 || !validIds(missingStatementIds)
    || missingStatementIds.some(id => !requiredStatementIds.includes(id))) return null;
  return { expectedCurrentBaselineId, requiredStatementIds, missingStatementIds };
}

export const INITIATIVE_WRITER_CORRECTION_LIMIT = 2;
export const INITIATIVE_CORRECTABLE_ERRORS = new Set([
  "malformed-receipt", "reason-required", "finding-resolution-invalid",
  "CLASSIFICATION_REQUIRED",
]);

export type InitiativeFindingEvidence = {
  blobId: string;
  startLine: number;
  endLine: number;
  quote: string;
};

export function findingEvidenceMatchesRead(
  evidence: InitiativeFindingEvidence,
  page: Record<string, unknown>,
  blobId: string,
): boolean {
  if (evidence.blobId !== blobId || page.blobId !== blobId
    || typeof page.content !== "string" || typeof page.startLine !== "number" || typeof page.endLine !== "number"
    || !Number.isSafeInteger(evidence.startLine) || !Number.isSafeInteger(evidence.endLine)
    || evidence.startLine < page.startLine || evidence.endLine > page.endLine || evidence.endLine < evidence.startLine
    || typeof evidence.quote !== "string" || !evidence.quote.trim()) return false;
  const cited = page.content.split("\n").slice(evidence.startLine - page.startLine, evidence.endLine - page.startLine + 1).join("\n");
  return cited.includes(evidence.quote);
}
