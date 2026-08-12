// apps/web/components/workbooks/SurfaceViewSwitcher.tsx
// Consistent List / Grid / Board switch revealed on a domain surface (Finance,
// Compliance, Ops). Registry-driven (EP-GRID-WORKBOOKS per-surface integration):
// every platform table gets the identical affordance for free. Mirrors the
// existing /workbooks/system toggle styling. Theme tokens only.
import Link from "next/link";

import { getHomeSurfaceForEntity } from "@/lib/workbooks/platform-tables";
import {
  buildSurfaceViewHref,
  type SurfaceDataScope,
  type SurfaceView,
} from "@/lib/workbooks/surface-view";

const ACTIVE_OPTION_CLASS =
  "bg-[var(--dpf-surface-2)] px-3 py-1.5 font-medium text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--dpf-accent)]";
const INACTIVE_OPTION_CLASS =
  "px-3 py-1.5 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--dpf-accent)]";

export function SurfaceViewSwitcher({
  entityType,
  current,
  dataScope = "default",
}: {
  entityType: string;
  current: SurfaceView;
  dataScope?: SurfaceDataScope;
}) {
  const home = getHomeSurfaceForEntity(entityType);
  if (!home) return null;

  const tabs: Array<{ key: SurfaceView; label: string; href: string }> = [
    {
      key: "list",
      label: "List",
      href: buildSurfaceViewHref(home.path, "list", dataScope),
    },
    {
      key: "grid",
      label: "Grid",
      href: buildSurfaceViewHref(home.path, "grid", dataScope),
    },
  ];
  if (home.board) {
    tabs.push({
      key: "board",
      label: "Board",
      href: buildSurfaceViewHref(home.path, "board", dataScope),
    });
  }

  const lens = current === "list" ? undefined : home.defaultDataLens;

  return (
    <div className="mb-4 flex w-fit max-w-full flex-wrap items-center gap-2 text-sm">
      <div
        className="inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)]"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={current === t.key ? "page" : undefined}
            className={current === t.key ? ACTIVE_OPTION_CLASS : INACTIVE_OPTION_CLASS}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {lens ? (
        <div
          role="group"
          aria-label={`${home.label} data scope`}
          className="inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)]"
        >
          {([
            { scope: "default" as const, label: lens.defaultLabel },
            { scope: "all" as const, label: lens.allLabel },
          ]).map((option) => (
            <Link
              key={option.scope}
              href={buildSurfaceViewHref(home.path, current, option.scope)}
              aria-current={dataScope === option.scope ? "page" : undefined}
              className={dataScope === option.scope ? ACTIVE_OPTION_CLASS : INACTIVE_OPTION_CLASS}
            >
              {option.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
