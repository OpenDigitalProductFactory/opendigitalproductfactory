"use client";

import type { SerializedViewElement } from "@/lib/ea-types";

import { buildValueStreamLayout } from "./value-stream-layout";

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

function chevronClipPath(inset = 28): string {
  return `polygon(0 0, calc(100% - ${inset}px) 0, 100% 50%, calc(100% - ${inset}px) 100%, 0 100%, ${inset}px 50%)`;
}

export function StructuredValueStreamNode({ data, selected = false }: Props) {
  const childStages = data.childViewElements ?? [];
  const layout = buildValueStreamLayout(childStages.map((stage) => stage.element.name));
  const childIssueCount = childStages.reduce((sum, stage) => sum + stage.structureIssueCount, 0);
  const issueCount = data.structureIssueCount > 0 ? data.structureIssueCount : childIssueCount;

  const bandBorder = issueCount > 0 ? "#f97316" : "#d97706";
  const bandShadow = selected
    ? "0 0 0 3px rgba(245, 158, 11, 0.18)"
    : "0 14px 28px rgba(120, 53, 15, 0.14)";

  return (
    <div
      data-value-stream-band="true"
      style={{
        width: layout.bandWidth + 24,
        minHeight: layout.bandHeight,
        clipPath: chevronClipPath(),
        border: `2px solid ${bandBorder}`,
        background: "linear-gradient(135deg, #ffd6a0 0%, #ffbf72 45%, #f7a74d 100%)",
        boxShadow: bandShadow,
        padding: "14px 88px 16px 36px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        data-value-stream-header="true"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        <div data-value-stream-title-block="true" style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#7c2d12",
            }}
          >
            Value Stream
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#431407",
              marginTop: 3,
              lineHeight: 1.2,
            }}
          >
            {data.element.name}
          </div>
        </div>

        <div
          data-value-stream-meta-block="true"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#7c2d12",
              textAlign: "right",
              whiteSpace: "nowrap",
            }}
          >
            {data.element.lifecycleStage} / {data.element.lifecycleStatus}
          </div>

          <div
            style={{
              padding: "4px 9px",
              borderRadius: 999,
              background: "rgba(255, 247, 237, 0.7)",
              border: "1px solid rgba(194, 65, 12, 0.24)",
              color: "#7c2d12",
              fontSize: 10,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {childStages.length} stage{childStages.length === 1 ? "" : "s"}
          </div>

          {issueCount > 0 ? (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(255, 247, 237, 0.86)",
                border: "1px solid #f97316",
                color: "#9a3412",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Structural warning: {issueCount} issue{issueCount === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
