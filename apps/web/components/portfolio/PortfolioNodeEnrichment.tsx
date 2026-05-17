// apps/web/components/portfolio/PortfolioNodeEnrichment.tsx
//
// Renders the typed enrichment view-model fields as a full-width band on the
// portfolio detail page. Task 3.3 of the discovery -> portfolio gap closure
// plan, plus BI-4C166411 commercial market/product guidance.
//
// Per spec section 6.4: no nested cards; full-width band with theme tokens
// only. Each subsection only renders when its source field is non-null and
// non-empty -- we never show "0 standards" or an empty <ul>.

import type { ReactElement } from "react";
import type { EnrichmentView } from "@/lib/portfolio/portfolio-node-view-model";

type Props = {
  enrichment: EnrichmentView;
};

function hasItems<T>(arr: T[] | null | undefined): arr is T[] {
  return arr !== null && arr !== undefined && arr.length > 0;
}

function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0;
}

function TextBlock({
  label,
  value,
  disclosed = false,
}: {
  label: string;
  value: string;
  disclosed?: boolean;
}): ReactElement {
  if (disclosed) {
    return (
      <details className="mb-4 border-l border-[var(--dpf-border)] pl-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-muted)]">
          {label}
        </summary>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--dpf-text)]">
          {value}
        </p>
      </details>
    );
  }

  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-[var(--dpf-muted)] mb-1">{label}</p>
      <p className="whitespace-pre-line text-sm leading-6 text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

export function PortfolioNodeEnrichment({ enrichment }: Props): ReactElement | null {
  const {
    standards,
    patterns,
    references,
    sampleServices,
    offeringConsiderations,
    commercialMarket,
    sectorCommercialMarkets,
  } = enrichment;
  const showStandards = hasItems(standards);
  const showPatterns = hasItems(patterns);
  const showReferences = hasItems(references);
  const showSampleServices = hasText(sampleServices);
  const showOfferingConsiderations = hasText(offeringConsiderations);
  const showCommercialMarket = hasText(commercialMarket);
  const showSectorCommercialMarkets = hasItems(sectorCommercialMarkets);
  if (
    !showStandards &&
    !showPatterns &&
    !showReferences &&
    !showSampleServices &&
    !showOfferingConsiderations &&
    !showCommercialMarket &&
    !showSectorCommercialMarkets
  ) {
    return null;
  }

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-3">Enrichment</h2>

      {showSampleServices && <TextBlock label="Sample services" value={sampleServices} />}

      {showOfferingConsiderations && (
        <TextBlock
          disclosed
          label="Offering considerations"
          value={offeringConsiderations}
        />
      )}

      {showCommercialMarket && (
        <TextBlock disclosed label="Commercial market and products" value={commercialMarket} />
      )}

      {showSectorCommercialMarkets && (
        <details className="mb-4 border-l border-[var(--dpf-border)] pl-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-muted)]">
            Sector market guidance
          </summary>
          <ul className="mt-2 space-y-2 text-sm text-[var(--dpf-text)]">
            {sectorCommercialMarkets.map((entry) => (
              <li key={`${entry.sector}|${entry.market}`}>
                <span className="font-medium">{entry.sector}</span>
                <span className="text-[var(--dpf-muted)]"> - </span>
                <span className="whitespace-pre-line">{entry.market}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

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
