// Which failed semantic review still blocks a change (BI-38C51AF2).
//
// A review fails either on a finding in the change or because its independent
// failure-analysis challenge judged the analysis inadequate. Repairing only the
// analysis keeps the same head, tree and diff, so the repair round's pass sits
// beside the earlier fail on the same commit. Treating every fail on the head
// as permanent made that repair unreachable: the only exit was a new commit and
// a fresh full gate on an unchanged tree.
//
// A fail stops blocking only when its sole critical issue is the
// failure-analysis challenge AND a later receipt for the same head, tree and
// diff passed with an adequate failure-analysis review. A finding in the change
// always blocks until the change itself is repaired.

export const FAILURE_ANALYSIS_CHALLENGE_ISSUE = "Independent failure-analysis challenge is missing or inadequate.";

export type SemanticReceiptRow = { id: string; createdAt: Date; details: unknown };

type Receipt = {
  sourceHeadSha: string; headTreeHash: string; diffDigest: string;
  decision: string; adequate: boolean; criticals: string[];
};

function readReceipt(details: unknown): Receipt | null {
  if (!details || typeof details !== "object") return null;
  const value = details as Record<string, unknown>;
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : null;
  if (!result || typeof value.sourceHeadSha !== "string" || typeof result.decision !== "string") return null;
  const review = result.failureAnalysisReview && typeof result.failureAnalysisReview === "object"
    ? result.failureAnalysisReview as Record<string, unknown> : null;
  const issues = Array.isArray(result.issues) ? result.issues : [];
  return {
    sourceHeadSha: value.sourceHeadSha, headTreeHash: String(value.headTreeHash ?? ""), diffDigest: String(value.diffDigest ?? ""),
    decision: result.decision, adequate: review?.adequate === true,
    criticals: issues.flatMap(issue => issue && typeof issue === "object" && (issue as Record<string, unknown>).severity === "critical"
      ? [String((issue as Record<string, unknown>).description ?? "")] : []),
  };
}

const sameChange = (a: Receipt, b: Receipt) =>
  a.sourceHeadSha === b.sourceHeadSha && a.headTreeHash !== "" && a.headTreeHash === b.headTreeHash && a.diffDigest === b.diffDigest;

/** A fail whose only critical issue is the failure-analysis challenge; unreadable details are not. */
export function isFailureAnalysisOnlyFail(details: unknown): boolean {
  const receipt = readReceipt(details);
  return receipt !== null && receipt.decision === "fail" && !receipt.adequate && receipt.criticals.length > 0
    && receipt.criticals.every(description => description === FAILURE_ANALYSIS_CHALLENGE_ISSUE);
}

/** The first fail that still blocks, or null. Row order does not matter. */
export function blockingSemanticFailure(rows: readonly SemanticReceiptRow[]): { id: string } | null {
  const receipts = rows.flatMap(row => {
    const receipt = readReceipt(row.details);
    return receipt ? [{ row, receipt }] : [];
  });
  for (const { row, receipt } of receipts) {
    if (receipt.decision !== "fail") continue;
    const repaired = isFailureAnalysisOnlyFail(row.details) && receipts.some(later => later.row.createdAt > row.createdAt
      && later.receipt.decision === "pass" && later.receipt.adequate && sameChange(later.receipt, receipt));
    if (!repaired) return { id: row.id };
  }
  return null;
}
