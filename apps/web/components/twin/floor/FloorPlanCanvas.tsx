"use client";

// Compatibility adapter for the pre-persistence restaurant FloorScene.
// Rendering, node semantics, status colors, text alternative, and mode behavior
// now belong to the generic CartesianSceneCanvas. BI-287AA5F7 will replace this
// derived geometry with the persisted OperationalSceneLayout on /workspace.

import { useMemo } from "react";

import type { CartesianSceneLayout } from "@dpf/storefront-templates";

import { CartesianSceneCanvas } from "@/components/twin/cartesian/CartesianSceneCanvas";
import type { FloorPlacement, FloorScene } from "@/lib/storefront/floor-layout";
import type { CartesianScenePresentationMap } from "@/lib/twin/cartesian-scene";

function placementSublabel(placement: FloorPlacement): string | undefined {
  const details = [
    placement.seats != null ? `${placement.seats} seats` : null,
    placement.freeInMinutes != null
      ? `Free in ${placement.freeInMinutes} min`
      : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(" · ") : undefined;
}

export interface FloorPlanCanvasProps {
  scene: FloorScene;
  /** Canvas height in px (the width fills its container). */
  height?: number;
}

export function FloorPlanCanvas({ scene, height = 520 }: FloorPlanCanvasProps) {
  const layout = useMemo<CartesianSceneLayout>(
    () => ({
      schemaVersion: 1,
      spaceKind: "cartesian-interior",
      viewport: { x: 0, y: 0, zoom: 1 },
      zones: scene.zones.map((zone) => ({
        id: zone.section,
        label: zone.label,
        geometry: {
          kind: "rectangle",
          x: zone.x,
          y: zone.y,
          width: zone.w,
          height: zone.h,
        },
      })),
      placements: scene.placements.map((placement) => ({
        id: placement.key,
        label: placement.label,
        entityRef: { kind: "table", id: placement.key },
        geometry: {
          x: placement.x,
          y: placement.y,
          width: placement.w,
          height: placement.h,
          rotation: 0,
          shapeKind: `${placement.shape}-table`,
        },
      })),
    }),
    [scene],
  );
  const bindings = useMemo<CartesianScenePresentationMap>(
    () =>
      Object.fromEntries(
        scene.placements.map((placement) => {
          const sublabel = placementSublabel(placement);
          return [
            `table:${placement.key}`,
            {
              label: placement.label,
              statusLabel: placement.stateLabel,
              ...(sublabel ? { sublabel } : {}),
              intent: placement.intent,
            },
          ];
        }),
      ),
    [scene],
  );

  return (
    <CartesianSceneCanvas
      ariaLabel="Restaurant floor"
      scene={layout}
      bindings={bindings}
      mode="read-only"
      height={height}
      empty={
        <p className="text-dpf-body text-dpf-muted">
          No tables are configured yet.
        </p>
      }
    />
  );
}
