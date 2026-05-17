"use client";

import { useMemo, useState } from "react";
import { Activity, GitBranch, Layers3, Network, Target } from "lucide-react";

import { CapabilityDetailPanel } from "@/components/portfolio/architecture/CapabilityDetailPanel";
import { CapabilityMapCanvas } from "@/components/portfolio/architecture/CapabilityMapTiles";
import type {
  BusinessCapabilityNode,
  BusinessCapabilitySummary,
} from "@/lib/business-capabilities/data";
import { CAPABILITY_OVERLAY_MODES, type CapabilityOverlayMode } from "@/lib/business-capabilities/types";
import type { BusinessCapabilityMapRow } from "@/lib/business-capabilities/view-model";

type Props = {
  mapRows: BusinessCapabilityMapRow[];
  summary: BusinessCapabilitySummary;
};

const metricToneVars = {
  aligned: "var(--dpf-success)",
  gap: "var(--dpf-error)",
  default: "var(--dpf-accent)",
} as const;

export function BusinessCapabilityMapClient({ mapRows, summary }: Props) {
  const [overlayMode, setOverlayMode] = useState<CapabilityOverlayMode>("maturity");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);

  const capabilities = useMemo(() => flattenCapabilities(mapRows), [mapRows]);
  const selectedCapability =
    capabilities.find((capability) => capability.id === selectedCapabilityId) ?? capabilities[0] ?? null;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryMetric icon={Layers3} label="Capabilities" value={summary.totalCapabilities} />
        <SummaryMetric icon={Network} label="Families" value={summary.l1Count} />
        <SummaryMetric icon={GitBranch} label="L2" value={summary.l2Count} />
        <SummaryMetric icon={Target} label="L3" value={summary.l3Count} />
        <SummaryMetric icon={Activity} label="Gaps" value={summary.gapCount} tone="gap" />
        <SummaryMetric icon={Activity} label="Aligned" value={summary.alignedCount} tone="aligned" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">Overlay</p>
          <p className="text-sm font-medium text-[var(--dpf-text)]">
            {CAPABILITY_OVERLAY_MODES.find((mode) => mode.value === overlayMode)?.label}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Capability map overlay">
          {CAPABILITY_OVERLAY_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={overlayMode === mode.value}
              onClick={() => setOverlayMode(mode.value)}
              className={[
                "rounded border px-3 py-2 text-xs font-medium transition",
                overlayMode === mode.value
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white"
                  : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]",
              ].join(" ")}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <CapabilityMapCanvas
          mapRows={mapRows}
          overlayMode={overlayMode}
          selectedCapabilityId={selectedCapability?.id ?? null}
          onSelectCapability={setSelectedCapabilityId}
        />
        <CapabilityDetailPanel capability={selectedCapability} overlayMode={overlayMode} />
      </div>
    </section>
  );
}

function flattenCapabilities(rows: BusinessCapabilityMapRow[]): BusinessCapabilityNode[] {
  const flattened: BusinessCapabilityNode[] = [];

  const visit = (node: BusinessCapabilityNode) => {
    flattened.push(node);
    node.children.forEach(visit);
  };

  for (const row of rows) {
    row.families.forEach(visit);
  }

  return flattened;
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Layers3;
  label: string;
  value: number;
  tone?: "aligned" | "gap";
}) {
  const color = tone ? metricToneVars[tone] : metricToneVars.default;
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
        <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">{label}</p>
      </div>
      <p className="mt-2 text-xl font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}
