"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PhaseNodeData } from "@/lib/build/process-graph-builder";

/**
 * 16px circle node used as fork/join point in the task graph.
 * No label, no interaction — purely structural.
 */
export const ForkJoinNode = memo(function ForkJoinNode({ data }: NodeProps) {
  const nodeData = data as PhaseNodeData;
  const color = nodeData.color;

  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: color,
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
    </div>
  );
});
