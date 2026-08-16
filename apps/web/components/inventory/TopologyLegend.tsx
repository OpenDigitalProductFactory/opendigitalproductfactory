import { LEGEND_ENTRIES, PHYSICAL_LEGEND_ENTRIES } from "@/lib/graph/device-icons";

export function TopologyLegend({ physical }: { physical: boolean }) {
  const entries = physical ? PHYSICAL_LEGEND_ENTRIES : LEGEND_ENTRIES;
  return (
    <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 text-dpf-caption text-[var(--dpf-muted)]">
      {entries.map((entry) => (
        <span key={entry.ciType} className="flex items-center gap-1">
          <span style={{ color: entry.visual.color, fontSize: 11 }}>{entry.visual.symbol}</span>
          {entry.visual.label}
        </span>
      ))}
    </div>
  );
}
