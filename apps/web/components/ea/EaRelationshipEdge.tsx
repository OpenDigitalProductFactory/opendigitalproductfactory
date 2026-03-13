"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from "@xyflow/react";
import type { SerializedEdge } from "@/lib/ea-types";

type EaEdgeData = Pick<SerializedEdge, "relationshipType">;

export const EaRelationshipEdge = memo(function EaRelationshipEdge({
  id, sourceX, sourceY, targetX, targetY, data,
}: EdgeProps) {
  const edgeData = data as EaEdgeData | undefined;
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: "#7c8cf8", strokeWidth: 1.5 }} markerEnd="url(#arrow)" />
      {edgeData?.relationshipType.name && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 8,
              color: "#7c8cf8",
              background: "#0f0f1a",
              padding: "1px 3px",
              borderRadius: 2,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            {edgeData.relationshipType.name.toLowerCase()}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
