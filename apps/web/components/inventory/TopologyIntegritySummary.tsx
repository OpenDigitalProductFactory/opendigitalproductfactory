import type { PhysicalTopologyIntegrity } from "@/lib/graph/physical-topology";
import { RelativeTime } from "@/components/ui/RelativeTime";

export function TopologyIntegritySummary({ integrity }: { integrity: PhysicalTopologyIntegrity }) {
  return (
    <section
      aria-label="Physical topology evidence"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-dpf-caption"
      data-topology-integrity={integrity.state}
    >
      <span className="font-medium text-[var(--dpf-text)]">Evidence: {integrity.state}</span>
      <span className="text-[var(--dpf-muted)]">
        {integrity.deviceCount} devices / {integrity.physicalLinkCount} physical links
      </span>
      {integrity.sources.length > 0 && (
        <span className="text-[var(--dpf-muted)]">Source: {integrity.sources.join(", ")}</span>
      )}
      {integrity.newestObservedAt && (
        <span className="text-[var(--dpf-muted)]">
          Observed: <RelativeTime value={integrity.newestObservedAt} />
        </span>
      )}
      <span className="basis-full text-[var(--dpf-muted)]">{integrity.message}</span>
      {integrity.state !== "current" && (
        <a className="text-[var(--dpf-accent)] underline" href="/platform/tools/discovery">
          Open Estate Discovery
        </a>
      )}
    </section>
  );
}
