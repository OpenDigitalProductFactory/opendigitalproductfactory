import Link from "next/link";
import type { MaterialBacklinksResult } from "@/lib/decision-perspective/material-backlinks";

import { BacklinkGroup, type BacklinkItem } from "@/components/wiki/BacklinkGroup";

export function MaterialBacklinksPanel({ result }: { result: MaterialBacklinksResult }) {
  if (result.missingReason !== "none") {
    return (
      <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]">
        <h2 className="text-sm font-semibold">Material Backlinks</h2>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">No linked material graph is available for this source.</p>
      </section>
    );
  }

  if (result.material.reviewStatus !== "approved" || result.material.promotionState !== "promoted") {
    return (
      <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]">
        <h2 className="text-sm font-semibold">Material Backlinks</h2>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">
          This material is waiting for review and is not active doctrine yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]" aria-label="Material backlinks">
      <div>
        <h2 className="text-sm font-semibold">Material Backlinks</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {result.wikiNeighborhood.page?.title ?? result.material.summary ?? "Linked material"}
        </p>
      </div>

      <BacklinkGroup label="Stances and heuristics" items={toItems(result.wikiNeighborhood.stancesAndHeuristics)} />
      <BacklinkGroup label="Referenced by" items={toItems(result.wikiNeighborhood.inLinks)} />
      <BacklinkGroup label="References" items={toItems(result.wikiNeighborhood.outLinks)} />

      <div>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)]">Citations</h3>
        <div className="mt-2 space-y-2">
          {result.sources.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No citations linked.</p>
          ) : (
            result.sources.map((source) => (
              <div key={source.id} className="space-y-1">
                {source.url ? (
                  <Link className="text-sm font-medium text-[var(--dpf-accent)]" href={source.url}>
                    {source.title}
                  </Link>
                ) : (
                  <p className="text-sm font-medium">{source.title}</p>
                )}
                <p className="text-xs text-[var(--dpf-muted)]">{source.sourceType}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)]">Prior Decisions</h3>
        <div className="mt-2 space-y-2">
          {result.priorDecisions.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No prior decisions reference this material.</p>
          ) : (
            result.priorDecisions.map((decision) => (
              <Link
                key={decision.interactionId}
                className="block border-b border-[var(--dpf-border)] pb-2 text-sm last:border-b-0 last:pb-0"
                href={`/coworker-decisions/decisions/${encodeURIComponent(decision.interactionId)}`}
              >
                <span className="block font-medium">{decision.question}</span>
                <span className="mt-1 block text-xs text-[var(--dpf-muted)]">{decision.outcomeType ?? "outcome"}</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function toItems(pages: MaterialBacklinksResult["wikiNeighborhood"]["inLinks"]): BacklinkItem[] {
  return pages.map((page) => ({ id: page.id, title: page.title, href: `/coworker-decisions/${page.slug}` }));
}
