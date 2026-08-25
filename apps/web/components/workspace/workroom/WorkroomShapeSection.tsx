"use client";

import type { ShapeGraph } from "@/lib/work-management/shape-projection";
import type { WorkroomView } from "@/lib/work-management/room-types";

import { ShapeViewToggle, type WorkroomViewMode } from "./ShapeViewToggle";
import { WorkroomShape } from "./WorkroomShape";

/**
 * Keeps definition/occurrence context next to the room's disclosure control.
 */
export function WorkroomShapeSection({
  graph,
  room,
  mode,
  onModeChange,
}: {
  graph: ShapeGraph;
  room: WorkroomView;
  mode: WorkroomViewMode;
  onModeChange: (next: WorkroomViewMode) => void;
}) {
  const definition = room.identity.definition;
  const occurrenceLabel = room.mode === "standing"
    ? room.currentCycle ? "This room · Active cycle" : "This room · Standing stream"
    : "This room · Single occurrence";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
            {"Room definition"}
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">
            {definition ? `${definition.label} · Definition v${definition.version}` : "Definition not resolved"}
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{occurrenceLabel}</p>
        </div>
        <ShapeViewToggle mode={mode} onChange={onModeChange} />
      </div>
      {mode === "shape" ? <WorkroomShape graph={graph} /> : null}
    </div>
  );
}
