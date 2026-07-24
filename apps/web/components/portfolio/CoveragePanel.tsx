// Portfolio coverage surface (BI-PORTCOV-P6; spec §4.5). Renders a portfolio
// root's entries by coverage — what the org runs (`used`/`sold`), what is
// configurable now (`available`), and what it could turn on (`potential`) —
// with a provenance chip (which source projected it) and, for catalogued
// integrations, a governed "Enable" deep-link. Read-only summary; reuses the
// report-kit StatusBadge (theme-tokened intents). No new route.

import Link from "next/link";

import { StatusBadge } from "@/components/ui/report-kit";

type CoverageProduct = {
  id: string;
  productId: string;
  name: string;
  observationConfig: unknown;
};

type Props = {
  products: CoverageProduct[];
  className?: string;
};

/** Friendly labels for the projection source kinds (provenance chip). */
const SOURCE_LABELS: Record<string, string> = {
  network_discovery: "Discovered",
  manual_entry: "Curated",
  platform_capability: "Platform capability",
  capability_registry: "Capability",
  integration_registry: "Integration",
  ai_provider: "AI provider",
  sbom: "Bill of materials",
  archetype: "Archetype",
  incumbent_intake: "Runs today",
};

/** Most-committed first. Mirrors PORTFOLIO_COVERAGE_STATUSES ordering. */
const COVERAGE_ORDER = ["used", "incumbent", "sold", "available", "potential", "planned", "retired"];

function readMarker(cfg: unknown, key: string): string | null {
  if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
    const value = (cfg as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

export function CoveragePanel({ products, className = "" }: Props) {
  const rows = products
    .map((p) => ({
      id: p.id,
      productId: p.productId,
      name: p.name,
      coverage: readMarker(p.observationConfig, "coverageStatus"),
      source: readMarker(p.observationConfig, "sourceKind"),
    }))
    .filter((p): p is typeof p & { coverage: string } => p.coverage !== null);

  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    const ai = COVERAGE_ORDER.indexOf(a.coverage);
    const bi = COVERAGE_ORDER.indexOf(b.coverage);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.name.localeCompare(b.name);
  });

  return (
    <div className={className}>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        Coverage &amp; sources
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((p) => {
          const enableHref =
            p.source === "integration_registry" && p.coverage === "potential"
              ? `/platform/tools/integrations/${p.productId.replace(/^int-/, "")}`
              : null;
          return (
            <div
              key={p.id}
              className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <Link
                  href={`/portfolio/product/${p.id}`}
                  className="text-sm font-medium text-[var(--dpf-text)] hover:underline"
                >
                  {p.name}
                </Link>
                <div className="flex items-center gap-1.5 shrink-0">
                  {p.source ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                      {SOURCE_LABELS[p.source] ?? p.source}
                    </span>
                  ) : null}
                  <StatusBadge domain="portfolioCoverage" status={p.coverage} label={titleCase(p.coverage)} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-[var(--dpf-muted)]">{p.productId}</p>
                {enableHref ? (
                  <Link href={enableHref} className="text-[10px] text-[var(--dpf-accent)] hover:underline">
                    Enable &rarr;
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
