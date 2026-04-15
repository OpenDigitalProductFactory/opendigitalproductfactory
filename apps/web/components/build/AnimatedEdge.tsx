"use client";

import {
  BaseEdge,
  getBezierPath,
  MarkerType,
  type EdgeProps,
} from "@xyflow/react";
import type { NodeStatus } from "@/lib/build/process-graph-builder";

type AnimatedEdgeData = {
  sourceStatus?: NodeStatus;
  color?: string;
};

/**
 * Custom ReactFlow edge with dashed SVG path.
 * When the source node is running, dashes animate via the pg-edge-active CSS class.
 */
export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = data as AnimatedEdgeData | undefined;
  const sourceStatus: NodeStatus = edgeData?.sourceStatus ?? "pending";
  const roleColor = edgeData?.color ?? "var(--dpf-border)";

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Determine stroke color and width by status
  let strokeColor: string;
  let strokeWidth: number;

  switch (sourceStatus) {
    case "running":
      strokeColor = roleColor;
      strokeWidth = 3;
      break;
    case "done":
      strokeColor = `color-mix(in srgb, ${roleColor} 60%, transparent)`;
      strokeWidth = 2;
      break;
    case "error":
      strokeColor = "var(--dpf-error)";
      strokeWidth = 2;
      break;
    case "pending":
    default:
      strokeColor = "var(--dpf-border)";
      strokeWidth = 2;
      break;
  }

  const isRunning = sourceStatus === "running";

  return (
    <g className={isRunning ? "pg-edge-active" : undefined}>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: "8 4",
        }}
        {...(markerEnd !== undefined && { markerEnd })}
      />
    </g>
  );
}
