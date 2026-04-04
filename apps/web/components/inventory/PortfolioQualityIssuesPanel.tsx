"use client";

import { useState } from "react";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";

type PortfolioQualityIssue = {
  id: string;
  issueType: string;
  severity: string;
  summary: string;
  details?: Record<string, unknown> | null;
  inventoryEntity: { entityKey: string; name: string } | null;
  portfolio: { slug: string; name: string } | null;
  taxonomyNode: { nodeId: string; name: string } | null;
  digitalProduct: { productId: string; name: string } | null;
};

export function PortfolioQualityIssuesPanel({
  issues,
}: {
  issues: PortfolioQualityIssue[];
}) {
  const [configuringIssueId, setConfiguringIssueId] = useState<string | null>(null);

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

      <div className="mt-4 space-y-3">
        {issues.map((issue) => (
          <article
            key={issue.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--dpf-text)]">{issue.summary}</p>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                  {issue.issueType}
                </p>
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

      {issues.length === 0 && (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          No open portfolio quality issues from discovery.
        </p>
      )}
    </section>
  );
}
