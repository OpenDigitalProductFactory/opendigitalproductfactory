"use client";

// Cartesian floor-plan renderer (EP-SPATIAL-OPERATIONAL-VIEWS §4.1).
// The reusable "operate mode" surface: given a positioned `FloorScene`, draw the
// zones as backdrops and the resource units (tables) as status-coloured nodes on
// the platform's one canvas engine — React Flow (`@xyflow/react`), the same
// substrate as the EA canvas. Read-only here; the authoring editor (drag/resize
// + persisted geometry via OperationalSceneLayout) is the next increment.

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { FloorScene } from "@/lib/storefront/floor-layout";

import { FloorZoneNode } from "./FloorZoneNode";
import { TableFloorNode } from "./TableFloorNode";

const NODE_TYPES = { table: TableFloorNode, zone: FloorZoneNode };

function sceneToNodes(scene: FloorScene): Node[] {
  // Zones first so they paint behind the tables.
  const zoneNodes: Node[] = scene.zones.map((z) => ({
    id: `zone-${z.section}`,
    type: "zone",
    position: { x: z.x, y: z.y },
    data: { label: z.label, w: z.w, h: z.h },
    draggable: false,
    selectable: false,
    connectable: false,
    zIndex: 0,
  }));
  const tableNodes: Node[] = scene.placements.map((p) => ({
    id: p.key,
    type: "table",
    position: { x: p.x, y: p.y },
    data: {
      label: p.label,
      seats: p.seats,
      shape: p.shape,
      w: p.w,
      h: p.h,
      state: p.state,
      stateLabel: p.stateLabel,
      intent: p.intent,
      freeInMinutes: p.freeInMinutes,
    },
    draggable: false,
    selectable: false,
    connectable: false,
    zIndex: 1,
  }));
  return [...zoneNodes, ...tableNodes];
}

export interface FloorPlanCanvasProps {
  scene: FloorScene;
  /** Canvas height in px (the width fills its container). */
  height?: number;
}

export function FloorPlanCanvas({ scene, height = 520 }: FloorPlanCanvasProps) {
  const nodes = useMemo(() => sceneToNodes(scene), [scene]);

  return (
    <div
      className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
      style={{ height, borderRadius: 10, overflow: "hidden" }}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="var(--dpf-border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
