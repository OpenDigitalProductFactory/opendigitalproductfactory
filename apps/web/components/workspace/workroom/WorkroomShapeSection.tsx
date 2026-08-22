"use client";

import type { ShapeGraph } from "@/lib/work-management/shape-projection";

import { ShapeViewToggle, useWorkroomViewMode } from "./ShapeViewToggle";
import { WorkroomShape } from "./WorkroomShape";

/**
 * BI-23DB08BB. Holds the shape/detail choice for the room.
 *
 * "Detail" does not hide anything the reader needs — the full room detail is
 * rendered below this section either way. The toggle decides whether the
 * picture leads, which is the operator's call, not the surface's.
 */
export function WorkroomShapeSection({ graph }: { graph: ShapeGraph }) {
  const [mode, setMode] = useWorkroomViewMode();

  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <ShapeViewToggle mode={mode} onChange={setMode} />
      </div>
      {mode === "shape" ? <WorkroomShape graph={graph} /> : null}
    </div>
  );
}
