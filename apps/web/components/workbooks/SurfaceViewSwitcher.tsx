// apps/web/components/workbooks/SurfaceViewSwitcher.tsx
// Consistent List / Grid / Board switch revealed on a domain surface (Finance,
// Compliance, Ops). Registry-driven (EP-GRID-WORKBOOKS per-surface integration):
// every platform table gets the identical affordance for free. Mirrors the
// existing /workbooks/system toggle styling. Theme tokens only.
import Link from "next/link";

import { getHomeSurfaceForEntity } from "@/lib/workbooks/platform-tables";

export type SurfaceView = "list" | "grid" | "board";

export function SurfaceViewSwitcher({
  entityType,
  current,
}: {
  entityType: string;
  current: SurfaceView;
}) {
  const home = getHomeSurfaceForEntity(entityType);
  if (!home) return null;

  const tabs: Array<{ key: SurfaceView; label: string; href: string }> = [
    { key: "list", label: "List", href: home.path },
    { key: "grid", label: "Grid", href: `${home.path}?view=grid` },
  ];
  if (home.board) {
    tabs.push({ key: "board", label: "Board", href: `${home.path}?view=board` });
  }

  return (
    <div className="mb-4 inline-flex w-fit overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={
            current === t.key
              ? "bg-[var(--dpf-surface-2)] px-3 py-1.5 font-medium text-[var(--dpf-text)]"
              : "px-3 py-1.5 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
