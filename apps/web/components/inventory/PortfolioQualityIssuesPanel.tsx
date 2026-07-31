"use client";

import { useState } from "react";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";

type PortfolioQualityIssue = {
  id: string;
  issueType: string;
  severity: string;
  summary: string;
  details?: unknown;
  inventoryEntity: { entityKey: string; name: string } | null;
  portfolio: { slug: string; name: string } | null;
  taxonomyNode: { nodeId: string; name: string } | null;
  digitalProduct: { productId: string; name: string } | null;
};

/**
 * Cards rendered per issue type before the group collapses behind a "show all".
 * A discovery queue is unbounded by nature — one row per unenriched device — so
 * rendering it flat produced a page thousands of lines long in which the handful
 * of operator-actionable rows were unfindable. Grouping makes the SHAPE of the
 * queue the primary read; the rows stay one click away.
 */
const PREVIEW_PER_GROUP = 5;

function groupByIssueType(
  issues: PortfolioQualityIssue[],
): Array<{ issueType: string; issues: PortfolioQualityIssue[] }> {
  // Insertion-ordered: the server sorts by severity desc, so the first group is
  // the most severe. Preserving that beats re-sorting by count, which would bury
  // a single `error` behind a large `warn` queue.
  const groups = new Map<string, PortfolioQualityIssue[]>();
  for (const issue of issues) {
    const bucket = groups.get(issue.issueType);
    if (bucket) bucket.push(issue);
    else groups.set(issue.issueType, [issue]);
  }
  return [...groups].map(([issueType, grouped]) => ({ issueType, issues: grouped }));
}

export function PortfolioQualityIssuesPanel({
  issues,
}: {
  issues: PortfolioQualityIssue[];
}) {
  const [configuringIssueId, setConfiguringIssueId] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<ReadonlySet<string>>(new Set());

  const groups = groupByIssueType(issues);

  const toggleType = (issueType: string) => {
    setExpandedTypes((previous) => {
      const next = new Set(previous);
      if (next.has(issueType)) next.delete(issueType);
      else next.add(issueType);
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-white/10 bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Portfolio Quality
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Open Discovery Issues</h2>
        </div>
        <span className="text-sm text-[var(--dpf-muted)]">{issues.length} open</span>
      </div>

      <div className="mt-4 space-y-4">
        {groups.map((group) => {
          const expanded = expandedTypes.has(group.issueType);
          const visible = expanded
            ? group.issues
            : group.issues.slice(0, PREVIEW_PER_GROUP);
          return (
            <div key={group.issueType} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-dpf-caption uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                  {group.issueType}
                  <span className="ml-2 text-[var(--dpf-text)]">{group.issues.length}</span>
                </p>
                {(expanded || visible.length !== group.issues.length) && (
                  <button
                    type="button"
                    onClick={() => toggleType(group.issueType)}
                    className="rounded-full border border-[var(--dpf-border)] px-3 py-1 text-dpf-caption text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
                  >
                    {expanded ? "Show less" : `Show all ${group.issues.length}`}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {visible.map((issue) => (
          <article
            key={issue.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--dpf-text)]">{issue.summary}</p>
              </div>
              <div className="flex items-center gap-2">
                {issue.issueType === "gateway_connection_needed" && (
                  <button
                    onClick={() =>
                      setConfiguringIssueId(
                        configuringIssueId === issue.id ? null : issue.id,
                      )
                    }
                    className="rounded-md bg-[#7c8cf8] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#6b7bf7] transition-colors"
                  >
                    {configuringIssueId === issue.id ? "Cancel" : "Configure"}
                  </button>
                )}
                <span className="rounded-full bg-[#fb718520] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#fb7185]">
                  {issue.severity}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--dpf-muted)]">
              {issue.inventoryEntity && <span>Entity: {issue.inventoryEntity.name}</span>}
              {issue.portfolio && <span>Portfolio: {issue.portfolio.name}</span>}
              {issue.taxonomyNode && <span>Taxonomy: {issue.taxonomyNode.nodeId}</span>}
              {issue.digitalProduct && <span>Product: {issue.digitalProduct.name}</span>}
            </div>

            {issue.issueType === "gateway_connection_needed" &&
              configuringIssueId === issue.id && (
                <ConfigureConnectionInline
                  gatewayEntityId={
                    (issue.details as Record<string, unknown> | null)
                      ?.gatewayEntityId as string | undefined
                  }
                  gatewayAddress={
                    (issue.details as Record<string, unknown> | null)
                      ?.address as string | undefined
                  }
                  gatewayName={issue.inventoryEntity?.name ?? "Gateway"}
                  onComplete={() => setConfiguringIssueId(null)}
                />
              )}
          </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {issues.length === 0 && (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          No open portfolio quality issues from discovery.
        </p>
      )}
    </section>
  );
}
