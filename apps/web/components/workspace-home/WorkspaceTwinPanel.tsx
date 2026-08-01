// apps/web/components/workspace-home/WorkspaceTwinPanel.tsx
//
// The operational twin as it renders on the /workspace hero (EP-LIVING-BUSINESS-VIZ
// P3, increment 2). A thin wrapper over the sibling-owned `TwinView`: it adds the
// honest "demo data" badge and nothing else. `TwinView` is a client component; this
// server component renders it with serializable props.
//
// Plan: docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md

import { TwinView } from "@/components/twin";
import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import { RestaurantFloorOperations } from "@/components/twin/restaurant/RestaurantFloorOperations";
import { RoomsOperations } from "@/components/twin/rooms";
import type { WorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";
import type { CartesianScenePresentationMap } from "@/lib/twin/cartesian-scene";

export interface WorkspaceTwinPanelProps {
  presentation: WorkspaceTwinPresentation;
  className?: string;
}

export function WorkspaceTwinPanel({ presentation, className = "" }: WorkspaceTwinPanelProps) {
  if (presentation.restaurantFloor) {
    return (
      <div className={className}>
        <RestaurantFloorOperations
          view={presentation.restaurantFloor}
          scene={presentation.scene}
        />
      </div>
    );
  }

  if (presentation.roomsOperations) {
    return (
      <div className={className}>
        <RoomsOperations
          demo={presentation.roomsOperationsDemo}
          view={presentation.roomsOperations}
        />
      </div>
    );
  }

  const bindings: CartesianScenePresentationMap = Object.fromEntries(
    presentation.snapshot.zones.flatMap((zone) =>
      zone.units.map((unit) => [
        `table:${unit.key}`,
        {
          label: unit.label,
          statusLabel: unit.state,
          ...(unit.sublabel ? { sublabel: unit.sublabel } : {}),
          intent: unit.intent ?? "neutral",
        },
      ]),
    ),
  );
  const physicalScene = presentation.scene ? (
    <CartesianSceneCanvas
      ariaLabel="Restaurant floor"
      scene={presentation.scene.layout}
      bindings={bindings}
      mode="read-only"
      height={500}
    />
  ) : undefined;

  return (
    <div className={`flex flex-col gap-3 ${className}`.trim()}>
      {presentation.demo ? (
        <p
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--dpf-muted)]"
          data-testid="twin-demo-badge"
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--dpf-muted)]"
          />
          Demo data — live business projection pending
        </p>
      ) : null}
      <TwinView
        profile={presentation.profile}
        snapshot={presentation.snapshot}
        physicalScene={physicalScene}
      />
    </div>
  );
}
