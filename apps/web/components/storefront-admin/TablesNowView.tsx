"use client";

import { useMemo, useState } from "react";

import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import {
  capacityStateIntent,
  capacityStateLabel,
  type RestaurantTable,
} from "@/lib/storefront/restaurant-capacity";
import type { CartesianSceneMode } from "@/lib/twin/cartesian-scene";
import { saveOperationalCartesianScene } from "@/lib/twin/operational-scene-layout-actions";
import type { RestaurantOperationalScene } from "@/lib/twin/restaurant-scene-layout";

export interface TablesNowViewProps {
  tables: RestaurantTable[];
  scene: RestaurantOperationalScene | null;
}

function tableSublabel(table: RestaurantTable): string | undefined {
  const details = [
    table.seats != null ? `${table.seats} seats` : null,
    table.freeInMinutes != null
      ? `Free in ${table.freeInMinutes} min`
      : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(" · ") : undefined;
}

export function TablesNowView({ tables, scene }: TablesNowViewProps) {
  const [mode, setMode] = useState<CartesianSceneMode>("read-only");
  const bindings = useMemo(
    () =>
      Object.fromEntries(
        tables.map((table) => {
          const sublabel = tableSublabel(table);
          return [
            `table:${table.key}`,
            {
              label: table.label,
              statusLabel: capacityStateLabel(table.state),
              ...(sublabel ? { sublabel } : {}),
              intent: capacityStateIntent(table.state),
            },
          ];
        }),
      ),
    [tables],
  );

  return (
    <section
      aria-labelledby="tables-now-heading"
      className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div>
        <h2 id="tables-now-heading" className="text-sm font-semibold">
          Tables right now
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Live state is joined onto the saved floor. Choose Adjust layout to
          move tables without changing reservations.
        </p>
      </div>

      {scene ? (
        <CartesianSceneCanvas
          ariaLabel="Restaurant floor"
          scene={scene.layout}
          bindings={bindings}
          mode={mode}
          modeOptions={["read-only", "configure"]}
          onModeChange={setMode}
          persistence={{
            sceneId: scene.id,
            version: scene.version,
            onSave: saveOperationalCartesianScene,
          }}
          empty={
            <p className="text-dpf-body text-dpf-muted">
              No tables are configured yet.
            </p>
          }
        />
      ) : (
        <>
          <Notice variant="warn" title="Floor layout unavailable">
            The saved floor could not be loaded. Table state remains available
            in the list while the layout is repaired.
          </Notice>
          <ul
            aria-label="Restaurant table state"
            className="grid gap-2"
          >
            {tables.map((table) => (
              <li
                key={table.key}
                className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--dpf-border)] px-3"
              >
                <span className="flex-1">
                  {table.label}
                  {table.seats != null ? ` · ${table.seats} seats` : ""}
                  {table.freeInMinutes != null
                    ? ` · free in ${table.freeInMinutes} min`
                    : ""}
                </span>
                <StatusBadge
                  intent={capacityStateIntent(table.state)}
                  label={capacityStateLabel(table.state)}
                  variant="soft"
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
