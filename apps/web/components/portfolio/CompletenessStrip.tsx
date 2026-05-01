// apps/web/components/portfolio/CompletenessStrip.tsx
//
// Portfolio completeness strip (Task 7.2 of the discovery -> portfolio gap
// closure plan). Renders three orthogonal figures from
// `computePortfolioCompleteness` (Task 7.1) above the existing portfolio
// tree:
//
//   1. Required fields % — % of products whose taxonomy node's
//      `governance.requiredFields` are all populated. Degrades to em-dash
//      with tooltip when no node has required fields configured (Chunk 7
//      Task 7.3 not yet shipped).
//   2. Enrichment % — % of products with `enrichmentStatus === "enriched"`.
//      Degrades to em-dash with tooltip when the schema column doesn't
//      exist yet (Chunk 4 Task 4.1 not yet shipped).
//   3. Open issues — SUM of `openIssuesByType` values, with a top-3
//      breakdown line; "+N more" suffix when more than 3 issue types.
//
// `productCount` is rendered as a small muted "X products tracked" line on
// the right.
//
// Theme-aware: only var(--dpf-*) tokens per AGENTS.md §12.

import type { ReactElement } from "react";
import type { PortfolioCompletenessScores } from "@/lib/portfolio/completeness";

type Props = { scores: PortfolioCompletenessScores };

const TOOLTIP_REQUIRED_FIELDS_NULL =
  "No taxonomy node has required fields configured yet (set via Chunk 7 Task 7.3 once it ships)";

const TOOLTIP_ENRICHMENT_NULL =
  "Enrichment status not yet tracked (Chunk 4 Task 4.1 schema pending)";

export function CompletenessStrip({ scores }: Props): ReactElement {
  const { requiredFieldsScore, enrichmentScore, openIssuesByType, productCount } =
    scores;

  const totalOpenIssues = Object.values(openIssuesByType).reduce(
    (sum, n) => sum + n,
    0,
  );

  const sortedIssueTypes = Object.entries(openIssuesByType).sort(
    ([, a], [, b]) => b - a,
  );
  const topIssueTypes = sortedIssueTypes.slice(0, 3);
  const moreIssueTypes = Math.max(0, sortedIssueTypes.length - 3);

  return (
    <section
      aria-label="Portfolio completeness"
      className="flex flex-wrap items-start justify-between gap-6 px-5 py-4 mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex flex-wrap gap-8">
        <ScoreFigure
          label="Required fields"
          score={requiredFieldsScore}
          tooltip={TOOLTIP_REQUIRED_FIELDS_NULL}
        />
        <ScoreFigure
          label="Enrichment"
          score={enrichmentScore}
          tooltip={TOOLTIP_ENRICHMENT_NULL}
        />
        <div>
          <div className="text-[var(--dpf-muted)] text-xs uppercase tracking-wide font-medium">
            Open issues
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-[var(--dpf-text)]">
            {totalOpenIssues}
          </div>
          {topIssueTypes.length > 0 ? (
            <div className="mt-1 text-[var(--dpf-muted)] text-xs">
              {topIssueTypes.map(([type, count], idx) => (
                <span key={type}>
                  {idx > 0 ? " · " : null}
                  {count} {type}
                </span>
              ))}
              {moreIssueTypes > 0 ? (
                <span className="ml-1">+ {moreIssueTypes} more</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="text-[var(--dpf-muted)] text-xs tabular-nums self-center">
        {productCount} products tracked
      </div>
    </section>
  );
}

function ScoreFigure({
  label,
  score,
  tooltip,
}: {
  label: string;
  score: number | null;
  tooltip: string;
}): ReactElement {
  if (score === null) {
    return (
      <div>
        <div className="text-[var(--dpf-muted)] text-xs uppercase tracking-wide font-medium">
          {label}
        </div>
        <div
          className="mt-1 text-3xl font-bold tabular-nums text-[var(--dpf-muted)] cursor-help"
          title={tooltip}
          aria-label={tooltip}
        >
          {"—"}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[var(--dpf-muted)] text-xs uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-[var(--dpf-text)]">
        {Math.round(score)}
        <span className="text-base font-medium text-[var(--dpf-muted)] ml-0.5">%</span>
      </div>
    </div>
  );
}
