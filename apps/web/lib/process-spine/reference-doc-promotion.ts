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