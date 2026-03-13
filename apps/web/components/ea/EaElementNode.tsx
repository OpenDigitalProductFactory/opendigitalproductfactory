"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { layerFromNeoLabel, LAYER_COLOURS, type SerializedViewElement } from "@/lib/ea-types";

type EaElementNodeData = SerializedViewElement & { selected?: boolean };

export const EaElementNode = memo(function EaElementNode({ data, selected }: NodeProps) {
  const nodeData = data as EaElementNodeData;
  const layer = layerFromNeoLabel(nodeData.elementType.neoLabel);
  const fallback = { bg: "#CCE5FF", border: "#4a90d9" } as const;
  const colours = LAYER_COLOURS[layer] ?? fallback;
  const isReference = nodeData.mode === "reference";
  const isPropose = nodeData.mode === "propose";

  const borderStyle = isReference
    ? `2px dashed ${colours.border}`
    : isPropose
    ? `2px solid #7c8cf8`
    : `2px solid ${colours.border}`;

  const boxShadow = isPropose && selected ? "0 0 0 2px #7c8cf833" : undefined;
  const opacity = isReference ? 0.85 : 1;

  const displayName = isPropose && nodeData.proposedProperties?.["name"]
    ? String(nodeData.proposedProperties["name"])
    : nodeData.element.name;

  return (
    <div
      style={{
        padding: "8px 10px",
        background: colours.bg,
        border: borderStyle,
        borderRadius: 5,
        boxShadow,
        opacity,
        minWidth: 120,
        maxWidth: 160,
        position: "relative",
        userSelect: "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colours.border }} />
      <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#336", marginBottom: 2 }}>
        {nodeData.elementType.name} · {nodeData.mode}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#112" }}>{displayName}</div>
      <div style={{ fontSize: 8, color: "#446", marginTop: 2 }}>
        {nodeData.element.lifecycleStage} · {nodeData.element.lifecycleStatus}
      </div>
      {isReference && (
        <div style={{ position: "absolute", top: 4, right: 6, fontSize: 9, color: "#336", opacity: 0.7 }}>🔒</div>
      )}
      {isPropose && (
        <div style={{ position: "absolute", top: 4, right: 6, fontSize: 9, color: "#7c8cf8" }}>✏️</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: colours.border }} />
    </div>
  );
});
