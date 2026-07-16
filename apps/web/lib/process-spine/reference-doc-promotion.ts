// BI-8996BBBB — promote [reference-doc] architecture-review findings to
// structured ImprovementProposal rows (process-spine §6.5).

export type ReferenceDocIssue = {
  severity: string;
  description: string;
  suggestion?: string;
};

const REFERENCE_DOC_RE = /^\[reference-doc\]/i;

export function extractReferenceDocIssues(
  issues: ReferenceDocIssue[] | null | undefined,
): ReferenceDocIssue[] {
  if (!issues?.length) return [];
  return issues.filter((issue) => REFERENCE_DOC_RE.test(issue.description.trim()));
}

export function referenceDocProposalTitle(issue: ReferenceDocIssue): string {
  const stripped = issue.description.replace(REFERENCE_DOC_RE, "").trim();
  const short = stripped.length > 90 ? `${stripped.slice(0, 87)}...` : stripped;
  return `[reference-doc] ${short}`;
}

export function referenceDocProposalBody(issue: ReferenceDocIssue): string {
  return [
    issue.description.trim(),
    issue.suggestion ? `Suggested edit: ${issue.suggestion.trim()}` : null,
    "Source: architecture review [reference-doc] finding (process-spine §6.5).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ─── Backlog auto-file gate (BI-18685188) ─────────────────────────────────────

/**
 * Withhold ONLY `low`-severity `[reference-doc]` improvement proposals from
 * auto-filing into the backlog. This is the single shared rule applied at BOTH
 * auto-file paths — creation-time (propose_improvement → ingestBacklogItem) and
 * the reconcile orphan-drain — so it lives in one place.
 *
 * Why: the architecture-review scanner emits a large recurring batch of
 * low-severity `[reference-doc] … would benefit from …` doc-polish proposals
 * (promoteReferenceDocFindings sets severity="low", title="[reference-doc] …").
 * Auto-filing all of them re-inflates the open backlog every pass; they are
 * founder-reserved canonical-doc authorship (AGENTS.md, kernel principles,
 * architecture specs), hand-deferred in bulk. This mirrors the existing skill
 * exclusion (`category !== "skill"`, they run the governed skill-revision
 * lifecycle instead) — a conservative, additive, reversible extension.
 *
 * Nothing is lost: gated proposals are still created/kept as ImprovementProposal
 * rows and remain in the Improvements view for founder review; they are only
 * withheld from becoming BI-* backlog items. `medium`/`high`/`critical`
 * reference-doc proposals and every non-reference-doc proposal continue to
 * auto-file exactly as before.
 *
 * The severity THRESHOLD (which severities to keep, and whether reference-doc
 * suggestions belong in the backlog at all) is a founder-reserved policy
 * decision — see BI-18685188.
 */
export function isLowSeverityReferenceDocProposal(p: {
  title: string;
  severity: string;
}): boolean {
  return (
    (p.severity ?? "").trim().toLowerCase() === "low" &&
    REFERENCE_DOC_RE.test((p.title ?? "").trim())
  );
}