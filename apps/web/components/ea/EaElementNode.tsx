"use client";

import { memo } from "react";
import { Handle, Position, useConnection, type NodeProps } from "@xyflow/react";
import { layerFromNeoLabel, LAYER_COLOURS, type SerializedViewElement } from "@/lib/ea-types";

export const EaElementNode = memo(function EaElementNode({ id, data, selected }: NodeProps) {
  const nodeData = data as SerializedViewElement;
  const layer = layerFromNeoLabel(nodeData.elementType.neoLabel);
  const colours = LAYER_COLOURS[layer] ?? { bg: "#CCE5FF", border: "#4a90d9" };

  const connection = useConnection();
  const isConnecting = connection.inProgress;
  // This node is the source of the drag — don't highlight it as a target
  const isThisSource = isConnecting && connection.fromNode?.id === id;

  const isReference = nodeData.mode === "reference";
  const isPropose = nodeData.mode === "propose";

  const baseBorder = isReference
    ? `2px dashed ${colours.border}`
    : isPropose
    ? `2px solid #7c8cf8`
    : `2px solid ${colours.border}`;

  // Glow potential targets while a connection is being drawn
  const targetGlow = isConnecting && !isThisSource
    ? `0 0 0 2px ${colours.border}, 0 0 10px 3px ${colours.border}55`
    : undefined;
  const selectionGlow = isPropose && selected ? "0 0 0 2px #7c8cf833" : undefined;

  const displayName = isPropose && nodeData.proposedProperties?.["name"]
    ? String(nodeData.proposedProperties["name"])
    : nodeData.element.name;

  // All handles are typed "source" — ReactFlow connectionMode="loose" lets them act as targets too.
  // This enables connections from/to any side.
  const handleStyle = {
    width: 10, height: 10, borderRadius: "50%",
    background: colours.border,
    border: `1px solid ${colours.bg}`,
    opacity: isConnecting ? 1 : 0,
    transition: "opacity 0.15s ease",
  };

  return (
    <div
      style={{
        padding: "8px 10px",
        background: colours.bg,
        border: baseBorder,
        borderRadius: 5,
        boxShadow: targetGlow ?? selectionGlow,
        opacity: isReference ? 0.85 : 1,
        minWidth: 120,
        maxWidth: 160,
        position: "relative",
        userSelect: "none",
        transition: "box-shadow 0.15s ease",
      }}
      onMouseEnter={(e) => {
        // Show handles on hover even when not connecting
        e.currentTarget.querySelectorAll<HTMLElement>(".react-flow__handle").forEach((h) => {
          h.style.opacity = "1";
        });
      }}
      onMouseLeave={(e) => {
        if (!connection.inProgress) {
          e.currentTarget.querySelectorAll<HTMLElement>(".react-flow__handle").forEach((h) => {
            h.style.opacity = "0";
          });
        }
      }}
    >
      <Handle type="source" position={Position.Top}    style={handleStyle} />
      <Handle type="source" position={Position.Right}  style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="source" position={Position.Left}   style={handleStyle} />

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
    </div>
  );
});
