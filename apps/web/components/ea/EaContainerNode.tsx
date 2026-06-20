"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { layerFromNeoLabel, LAYER_COLOURS, type SerializedViewElement } from "@/lib/ea-types";

// A container (Package / Part Definition with children) in the containment view. React Flow
// sizes the node from node.style width/height; this fills that box with a titled, translucent
// frame so the nested child nodes render inside it. (BI-9E5EA3FF)
const HANDLES = [
  { position: Position.Top, id: "t" },
  { position: Position.Right, id: "r" },
  { position: Position.Bottom, id: "b" },
  { position: Position.Left, id: "l" },
];

export const EaContainerNode = memo(function EaContainerNode({ data, selected }: NodeProps) {
  const nodeData = data as SerializedViewElement;
  const layer = layerFromNeoLabel(nodeData.elementType.neoLabel);
  const colours = LAYER_COLOURS[layer] ?? { bg: "#CCE5FF", border: "#4a90d9" };
  const displayName =
    nodeData.mode === "propose" && nodeData.proposedProperties?.["name"]
      ? String(nodeData.proposedProperties["name"])
      : nodeData.element.name;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `1px solid ${selected ? "var(--dpf-accent)" : colours.border}`,
        borderRadius: 6,
        background: `${colours.border}0d`, // ~5% tint of the layer colour
        boxShadow: selected ? `0 0 0 1px var(--dpf-accent)` : undefined,
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "5px 8px",
          fontSize: 10,
          fontWeight: 700,
          color: "#112",
          background: colours.bg,
          borderBottom: `1px solid ${colours.border}`,
          borderRadius: "5px 5px 0 0",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          userSelect: "none",
        }}
        title={`${nodeData.elementType.name} · ${displayName}`}
      >
        <span style={{ color: "#557", fontWeight: 600, marginRight: 5 }}>{nodeData.elementType.name}</span>
        {displayName}
      </div>
      {HANDLES.map(({ position, id }) => (
        <Handle key={id} type="source" id={id} position={position} style={{ width: 6, height: 6, background: colours.border, opacity: 0 }} />
      ))}
    </div>
  );
});
