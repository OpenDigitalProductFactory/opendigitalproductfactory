// apps/web/components/portfolio/PortfolioNodeEnrichment.tsx
//
// Renders the typed enrichment view-model fields (standards, patterns,
// references) as a full-width band on the portfolio detail page. Task 3.3 of
// the discovery -> portfolio gap closure plan.
//
// Per spec section 6.4: no nested cards; full-width band with theme tokens
// only. Each subsection only renders when its source field is non-null and
// non-empty -- we never show "0 standards" or an empty <ul>.

import type { ReactElement } from "react";
import type { EnrichmentView } from "@/lib/portfolio/portfolio-node-view-model";

type Props = {
  enrichment: EnrichmentView;
};

function hasItems<T>(arr: T[] | null): arr is T[] {
  return arr !== null && arr.length > 0;
}

export function PortfolioNodeEnrichment({ enrichment }: Props): ReactElement | null {
  const { standards, patterns, references } = enrichment;
  const showStandards = hasItems(standards);
  const showPatterns = hasItems(patterns);
  const showReferences = hasItems(references);
  if (!showStandards && !showPatterns && !showReferences) return null;

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-3">Enrichment</h2>

      {showStandards && (
        <div className="mb-4">
          <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">Standards</p>
          <ul className="list-disc list-inside text-sm text-[var(--dpf-text)]">
            {standards!.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {showPatterns && (
        <div className="mb-4">
          <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">Patterns</p>
          <ul className="list-disc list-inside text-sm text-[var(--dpf-text)]">
            {patterns!.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {showReferences && (
        <div>
          <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">References</p>
          <ul className="text-sm">
            {references!.map((ref) => (
              <li key={`${ref.label}|${ref.href}`}>
                <a
                  href={ref.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--dpf-accent)] hover:underline"
                >
                  {ref.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
