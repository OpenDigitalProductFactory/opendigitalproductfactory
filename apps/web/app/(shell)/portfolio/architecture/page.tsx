import { BookOpen, Network } from "lucide-react";

import { BusinessCapabilityForms } from "@/components/portfolio/architecture/BusinessCapabilityForms";
import { BusinessCapabilityMap } from "@/components/portfolio/architecture/BusinessCapabilityMap";
import { getBusinessCapabilityMapData } from "@/lib/business-capabilities/data";

export default async function PortfolioArchitecturePage() {
  const data = await getBusinessCapabilityMapData();

  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--dpf-border)] pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Network className="h-5 w-5 text-[var(--dpf-accent)]" aria-hidden="true" />
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--dpf-muted)]">
                Enterprise Architecture
              </p>
            </div>
            <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Business Capability Map</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
              Stable enterprise abilities with maturity, impact links, and IT4IT alignment.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
              <BookOpen className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
              <span>Business architecture construct</span>
            </div>
          </div>
        </div>
      </header>

      <BusinessCapabilityMap mapRows={data.mapRows} summary={data.summary} />

      <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
          Capability authoring
        </summary>
        <div className="mt-4">
          <BusinessCapabilityForms capabilities={data.records} targetOptions={data.targetOptions} />
        </div>
      </details>
    </div>
  );
}
