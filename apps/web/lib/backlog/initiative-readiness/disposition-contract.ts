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

export const INITIATIVE_WRITER_CORRECTION_LIMIT = 2;
export const INITIATIVE_CORRECTABLE_ERRORS = new Set([
  "malformed-receipt", "reason-required", "finding-resolution-invalid",
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
