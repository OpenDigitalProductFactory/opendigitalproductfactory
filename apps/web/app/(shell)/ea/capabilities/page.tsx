// apps/web/app/(shell)/ea/capabilities/page.tsx
import { BusinessCapabilityForms } from "@/components/portfolio/architecture/BusinessCapabilityForms";
import { BusinessCapabilityMap } from "@/components/portfolio/architecture/BusinessCapabilityMap";
import { OptimizationCockpitSection } from "@/components/portfolio/architecture/OptimizationCockpitSection";
import { EaTabNav } from "@/components/ea/EaTabNav";
import { getBusinessCapabilityMapData } from "@/lib/business-capabilities/data";
import { loadOptimizationCockpitData } from "@/lib/optimization/load-cockpit-data";

export default async function EaCapabilitiesPage() {
  const [data, cockpit] = await Promise.all([
    getBusinessCapabilityMapData(),
    loadOptimizationCockpitData(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Business Capability Map — stable enterprise abilities with maturity, impact links, and IT4IT alignment.
        </p>
      </div>

      <EaTabNav />

      <BusinessCapabilityMap mapRows={data.mapRows} summary={data.summary} provenance={data.provenance} />

      <OptimizationCockpitSection data={cockpit} />

      <details className="mt-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
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
