"use client";

import { memo } from "react";
import { Handle, Position, useConnection, type NodeProps } from "@xyflow/react";
import { layerFromNeoLabel, LAYER_COLOURS, type SerializedViewElement } from "@/lib/ea-types";

// Each side has a source and target handle so React Flow can route edges in any direction.
// IDs are unique per handle to avoid React Flow warnings.
const SIDES = [
  { position: Position.Top,    sourceId: "t-s", targetId: "t-t" },
  { position: Position.Right,  sourceId: "r-s", targetId: "r-t" },
  { position: Position.Bottom, sourceId: "b-s", targetId: "b-t" },
  { position: Position.Left,   sourceId: "l-s", targetId: "l-t" },
];

export const EaElementNode = memo(function EaElementNode({ id, data, selected }: NodeProps) {
  const nodeData = data as SerializedViewElement;
  const layer = layerFromNeoLabel(nodeData.elementType.neoLabel);
  const colours = LAYER_COLOURS[layer] ?? { bg: "#CCE5FF", border: "#4a90d9" };

  const connection = useConnection();
  const isConnecting = connection.inProgress;
  const isThisSource = isConnecting && connection.fromNode?.id === id;

  const isReference = nodeData.mode === "reference";
  const isPropose = nodeData.mode === "propose";

  const baseBorder = isReference
    ? `2px dashed ${colours.border}`
    : isPropose
    ? `2px solid #7c8cf8`
    : `2px solid ${colours.border}`;

  const targetGlow = isConnecting && !isThisSource
    ? `0 0 0 2px ${colours.border}, 0 0 10px 3px ${colours.border}55`
    : undefined;
  const selectionGlow = isPropose && selected ? "0 0 0 2px #7c8cf833" : undefined;

  const displayName = isPropose && nodeData.proposedProperties?.["name"]
    ? String(nodeData.proposedProperties["name"])
    : nodeData.element.name;

  // Handles visible on hover or while connecting
  const handleVisible = isConnecting && !isThisSource;
  const handleStyle = {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: colours.border,
    border: `1px solid ${colours.bg}`,
    opacity: handleVisible ? 1 : 0,
    transition: "opacity 0.12s ease",
    zIndex: 10,
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
      {SIDES.map(({ position, sourceId, targetId }) => (
        <>
          <Handle
            key={sourceId}
            type="source"
            id={sourceId}
            position={position}
            style={handleStyle}
          />
          <Handle
            key={targetId}
            type="target"
            id={targetId}
            position={position}
            style={{ ...handleStyle, opacity: 0, pointerEvents: "none" }}
          />
        </>
      ))}

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
