"use client";

import { Handle, Position } from "@xyflow/react";

import type { SerializedViewElement } from "@/lib/ea-types";

import { estimateStageWidth } from "./value-stream-layout";

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

const HANDLE_SIZE = 10;

function chevronClipPath(inset = 18): string {
  return `polygon(0 0, calc(100% - ${inset}px) 0, 100% 50%, calc(100% - ${inset}px) 100%, 0 100%, ${inset}px 50%)`;
}

function renderHandle(position: Position, marker: string) {
  return (
    <Handle
      key={marker}
      type="source"
      id={marker}
      position={position}
      data-testid={marker}
      style={{
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: "50%",
        background: "#9a3412",
        border: "1px solid #fff7ed",
        opacity: 1,
        zIndex: 10,
      }}
    />
  );
}

export function ValueStreamStageNode({ data, selected = false }: Props) {
  const stageWidth = estimateStageWidth(data.element.name);
  const borderColor = data.structureIssueCount > 0 ? "#ea580c" : "#c2410c";

  return (
    <div
      data-value-stream-stage-node="true"
      style={{
        width: stageWidth,
        minHeight: 92,
        clipPath: chevronClipPath(),
        background:
          data.structureIssueCount > 0
            ? "linear-gradient(135deg, #fed7aa 0%, #fb923c 100%)"
            : "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)",
        border: `1px solid ${borderColor}`,
        padding: "14px 28px 14px 20px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "grab",
        boxShadow: selected ? "0 0 0 3px rgba(194, 65, 12, 0.18)" : "0 8px 18px rgba(120, 53, 15, 0.18)",
        color: "#431407",
        position: "relative",
      }}
    >
      {/* Handles positioned absolutely at the edges */}
      <div
        style={{
          position: "absolute",
          top: "-5px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        {renderHandle(Position.Top, "data-stage-handle-top")}
      </div>
      <div
        style={{
          position: "absolute",
          right: "-5px",
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        {renderHandle(Position.Right, "data-stage-handle-right")}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "-5px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        {renderHandle(Position.Bottom, "data-stage-handle-bottom")}
      </div>
      <div
        style={{
          position: "absolute",
          left: "-5px",
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        {renderHandle(Position.Left, "data-stage-handle-left")}
      </div>

      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#9a3412",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Value Stream Stage
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#431407",
          marginTop: 6,
          lineHeight: 1.3,
        }}
      >
        {data.element.name}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#7c2d12",
          marginTop: 10,
        }}
      >
        {data.element.lifecycleStage} / {data.element.lifecycleStatus}
      </div>
    </div>
  );
}
