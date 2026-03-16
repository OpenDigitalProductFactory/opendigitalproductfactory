// apps/web/components/shell/WorkspaceTiles.tsx
import Link from "next/link";
import type { WorkspaceTile } from "@/lib/permissions";

export type TileMetric = {
  label: string;
  value: string | number;
  color?: string;
};

export type TileStatus = {
  metrics?: TileMetric[];
  badge?: string;
  badgeColor?: string;
};

type Props = {
  tiles: WorkspaceTile[];
  tileStatus?: Record<string, TileStatus>;
};

export function WorkspaceTiles({ tiles, tileStatus = {} }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {tiles.map((tile) => {
        const status: TileStatus | undefined = tileStatus[tile.key];
        const badgeColor: string = status?.badgeColor ?? tile.accentColor;
        return (
          <Link
            key={tile.key}
            href={tile.route}
            className="group block p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-2 hover:bg-[var(--dpf-surface-2)] transition-colors"
            style={{ borderLeftColor: tile.accentColor }}
          >
            <p className="text-sm font-semibold text-white mb-1">{tile.label}</p>
            {/* Metric rows */}
            {status?.metrics && status.metrics.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {status.metrics.map((m) => (
                  <div key={m.label} className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[var(--dpf-muted)] truncate">{m.label}</span>
                    <span
                      className="text-[11px] font-medium tabular-nums"
                      style={{ color: m.color ?? "var(--dpf-muted)" }}
                    >
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {status?.badge !== undefined && (
              <span
                className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded"
                style={{ background: `${badgeColor}20`, color: badgeColor }}
              >
                {status.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
