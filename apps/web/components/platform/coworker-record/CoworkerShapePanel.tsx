"use client";

import type { ShapeGraph } from "@/lib/work-management/shape-projection";

import { ShapeViewToggle, useWorkroomViewMode } from "@/components/workspace/workroom/ShapeViewToggle";
import { WorkroomShape } from "@/components/workspace/workroom/WorkroomShape";

/**
 * BI-DB302392. The coworker's own shape, using the Workroom renderer unchanged.
 *
 * Deliberately not a second component: one visual grammar means a reader who
 * learns the room's picture can already read a coworker's. The toggle shares
 * the room's stored preference for the same reason.
 */
export function CoworkerShapePanel({ graph }: { graph: ShapeGraph }) {
  const [mode, setMode] = useWorkroomViewMode();

  return (
    <div className="mb-5">
      <div className="flex justify-end">
        <ShapeViewToggle mode={mode} onChange={setMode} />
      </div>
      {mode === "shape" ? <WorkroomShape graph={graph} /> : null}
    </div>
  );
}
