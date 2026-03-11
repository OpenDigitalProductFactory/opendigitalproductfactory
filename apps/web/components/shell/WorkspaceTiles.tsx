// apps/web/components/shell/WorkspaceTiles.tsx
import Link from "next/link";
import type { WorkspaceTile } from "@/lib/permissions";

type TileStatus = {
  count?: number;
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
        // noUncheckedIndexedAccess: tileStatus[tile.key] is TileStatus | undefined
        const status: TileStatus | undefined = tileStatus[tile.key];
        // exactOptionalPropertyTypes: resolve badgeColor before use to avoid
        // assigning undefined where string is expected
        const badgeColor: string = status?.badgeColor ?? tile.accentColor;
        return (
          <Link
            key={tile.key}
            href={tile.route}
            className="group block p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-2 hover:bg-[var(--dpf-surface-2)] transition-colors"
            style={{ borderLeftColor: tile.accentColor }}
          >
            <p className="text-sm font-semibold text-white mb-1">{tile.label}</p>
            {status?.count !== undefined && (
              <p className="text-xs text-[var(--dpf-muted)]">{status.count} items</p>
            )}
            {status?.badge !== undefined && (
              <span
                className="inline-block mt-2 text-xs px-2 py-0.5 rounded"
                style={{
                  background: `${badgeColor}20`,
                  color: badgeColor,
                }}
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
