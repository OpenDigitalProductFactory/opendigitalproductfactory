"use client";

// "Tables right now" — the owner's live capacity, as either a graphical floor
// plan (the facsimile: which tables are open / turning soon, at a glance) or the
// legible list. Both render the SAME `RestaurantTable[]` projection, so they
// reconcile by construction. Floor plan is the default; the list stays for
// scan-and-act. EP-SPATIAL-OPERATIONAL-VIEWS (BI-287AA5F7) increment 1.

import { useMemo, useState, type ReactNode } from "react";

import { StatusBadge } from "@/components/ui/report-kit";
import { FloorPlanCanvas } from "@/components/twin/floor/FloorPlanCanvas";
import { layoutRestaurantFloor } from "@/lib/storefront/floor-layout";
import {
  capacityStateIntent,
  capacityStateLabel,
  type RestaurantTable,
} from "@/lib/storefront/restaurant-capacity";

type View = "floor" | "list";

export interface TablesNowViewProps {
  tables: RestaurantTable[];
}

export function TablesNowView({ tables }: TablesNowViewProps) {
  const [view, setView] = useState<View>("floor");
  const scene = useMemo(() => layoutRestaurantFloor(tables), [tables]);

  return (
    <div className="border border-[var(--dpf-border)]" style={{ borderRadius: 10, overflow: "hidden" }}>
      <div
        className="bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]"
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}
      >
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Tables right now</div>
        <div role="tablist" aria-label="Table view" style={{ display: "flex", gap: 4 }}>
          <ViewTab current={view} value="floor" onSelect={setView}>
            Floor plan
          </ViewTab>
          <ViewTab current={view} value="list" onSelect={setView}>
            List
          </ViewTab>
        </div>
      </div>

      {view === "floor" ? (
        <FloorPlanCanvas scene={scene} />
      ) : (
        <div>
          {tables.map((t) => (
            <div
              key={t.key}
              className="border-b border-[var(--dpf-border)]"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}
            >
              <div style={{ flex: 1, fontSize: 14 }}>
                {t.label}
                {t.seats != null && (
                  <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                    {" "}
                    · {t.seats} seats
                  </span>
                )}
              </div>
              {t.state === "turning-soon" && t.freeInMinutes != null && (
                <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
                  free in {t.freeInMinutes}m
                </span>
              )}
              <StatusBadge
                intent={capacityStateIntent(t.state)}
                label={capacityStateLabel(t.state)}
                variant="soft"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewTab({
  current,
  value,
  onSelect,
  children,
}: {
  current: View;
  value: View;
  onSelect: (v: View) => void;
  children: ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={
        active
          ? "bg-[var(--dpf-accent)] text-white"
          : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] border border-[var(--dpf-border)]"
      }
      style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}
