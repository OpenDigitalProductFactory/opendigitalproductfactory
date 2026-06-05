import { BusinessCapabilityMapClient } from "@/components/portfolio/architecture/BusinessCapabilityMapClient";
import type { BusinessCapabilitySummary } from "@/lib/business-capabilities/data";
import type { BusinessCapabilityProvenance } from "@/lib/business-capabilities/provenance";
import type {
  BusinessCapabilityMapRow,
} from "@/lib/business-capabilities/view-model";

type Props = {
  mapRows: BusinessCapabilityMapRow[];
  summary: BusinessCapabilitySummary;
  provenance: BusinessCapabilityProvenance;
};

export function BusinessCapabilityMap({ mapRows, summary, provenance }: Props) {
  return (
    <section className="space-y-4">
      <CapabilityPerspectiveBadge provenance={provenance} />

      {mapRows.length === 0 ? (
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
          <p className="text-sm font-medium text-[var(--dpf-text)]">No business capabilities yet.</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Add an L1 family, then add L2 capabilities beneath it.
          </p>
        </section>
      ) : (
        <BusinessCapabilityMapClient mapRows={mapRows} summary={summary} />
      )}
    </section>
  );
}

function CapabilityPerspectiveBadge({ provenance }: { provenance: BusinessCapabilityProvenance }) {
  const archetypeText = provenance.archetypeLabel
    ? `${provenance.archetypeLabel} archetype`
    : "No selected archetype";
  const countText =
    provenance.seedCapabilityCount === 1
      ? "1 projected capability"
      : `${provenance.seedCapabilityCount} projected capabilities`;

  return (
    <section
      aria-label="Capability perspective provenance"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
            Capability perspective
          </p>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            {provenance.activePerspectiveLabel}
          </h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            {archetypeText}
            {provenance.category ? ` · ${provenance.category}` : ""}
            {" · "}
            {countText}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {provenance.sources.map((source) => (
            <span
              key={source.perspectiveId}
              title={source.source}
              className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)]"
            >
              {source.label}
            </span>
          ))}
        </div>
      </div>

      {provenance.projectionStatus === "manual-or-empty" ? (
        <p className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-xs text-[var(--dpf-muted)]">
          No seed-projected capabilities are active yet; existing manual capability rows remain visible.
        </p>
      ) : null}
    </section>
  );
}
