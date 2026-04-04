"use client";

import { type SerializedViewElement, LAYER_COLOURS } from "@/lib/ea-types";

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

export function BpmnLaneNode({ data, selected }: Props) {
  const colours = LAYER_COLOURS.bpmn_participant;
  const isPool = data.elementType.slug === "bpmn_pool";
  const children = data.childViewElements ?? [];

  return (
    <div
      style={{
        background: isPool ? colours.bg : `${colours.bg}88`,
        border: `${isPool ? 2 : 1}px solid ${colours.border}`,
        borderRadius: isPool ? 6 : 3,
        minWidth: isPool ? 600 : 500,
        minHeight: isPool ? 120 : 80,
        boxShadow: selected ? `0 0 0 2px ${colours.border}44` : undefined,
        userSelect: "none",
        position: "relative",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Vertical label band on the left */}
      <div
        style={{
          width: 28,
          minHeight: isPool ? 120 : 80,
          borderRight: `1px solid ${colours.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${colours.border}15`,
        }}
      >
        <div
          style={{
            writingMode: "vertical-lr",
            transform: "rotate(180deg)",
            fontSize: 10,
            fontWeight: 600,
            color: colours.border,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxHeight: isPool ? 100 : 60,
          }}
        >
          {data.element.name}
        </div>
      </div>
      {/* Content area (child elements rendered by React Flow via parentId) */}
      <div style={{ flex: 1, padding: 8, position: "relative" }}>
        {children.length === 0 && (
          <div style={{ fontSize: 9, color: "#888", fontStyle: "italic" }}>
            {isPool ? "Pool" : "Lane"} · {data.element.lifecycleStage}
          </div>
        )}
      </div>
    </div>
  );
}
