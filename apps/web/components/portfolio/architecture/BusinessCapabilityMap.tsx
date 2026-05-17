import { BusinessCapabilityMapClient } from "@/components/portfolio/architecture/BusinessCapabilityMapClient";
import type { BusinessCapabilitySummary } from "@/lib/business-capabilities/data";
import type { BusinessCapabilityMapRow } from "@/lib/business-capabilities/view-model";

type Props = {
  mapRows: BusinessCapabilityMapRow[];
  summary: BusinessCapabilitySummary;
};

export function BusinessCapabilityMap({ mapRows, summary }: Props) {
  if (mapRows.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <p className="text-sm font-medium text-[var(--dpf-text)]">No business capabilities yet.</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Add an L1 family, then add L2 capabilities beneath it.
        </p>
      </section>
    );
  }

  return <BusinessCapabilityMapClient mapRows={mapRows} summary={summary} />;
}
