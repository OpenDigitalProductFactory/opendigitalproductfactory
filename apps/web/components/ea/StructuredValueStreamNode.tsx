"use client";

import type { SerializedViewElement } from "@/lib/ea-types";

type Props = {
  data: SerializedViewElement;
  selected?: boolean;
};

function sortStages(stages: SerializedViewElement[]): SerializedViewElement[] {
  return [...stages].sort((left, right) => {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.viewElementId.localeCompare(right.viewElementId);
  });
}

function chevronClipPath(inset = 14): string {
  return `polygon(0 0, calc(100% - ${inset}px) 0, 100% 50%, calc(100% - ${inset}px) 100%, 0 100%, ${inset}px 50%)`;
}

export function StructuredValueStreamNode({ data, selected = false }: Props) {
  const stages = sortStages(data.childViewElements ?? []);
  const childIssueCount = stages.reduce((sum, stage) => sum + stage.structureIssueCount, 0);
  const issueCount = data.structureIssueCount > 0 ? data.structureIssueCount : childIssueCount;
  const canReorderStages = !data.isReadOnly && typeof data.onMoveStructuredChild === "function" && stages.length > 1;

  return (
    <div
      style={{
        width: 440,
        padding: 12,
        border: selected ? "2px solid #f59e0b" : "2px solid #c8b400",
        borderRadius: 10,
        background: "linear-gradient(135deg, #fff8bf 0%, #f3ea9e 100%)",
        boxShadow: selected ? "0 0 0 3px rgba(245, 158, 11, 0.18)" : undefined,
      }}
    >
      <div
        style={{
          clipPath: chevronClipPath(18),
          background: "linear-gradient(90deg, #ffe58f 0%, #facc15 100%)",
          padding: "14px 48px 14px 22px",
          border: "1px solid #c8b400",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a5400" }}>
          Value Stream
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#3b2f00", marginTop: 2 }}>
          {data.element.name}
        </div>
        <div style={{ fontSize: 11, color: "#5f4b00", marginTop: 4 }}>
          {data.element.lifecycleStage} / {data.element.lifecycleStatus}
        </div>
      </div>

      {issueCount > 0 ? (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            borderRadius: 8,
            background: "#fff1d6",
            border: "1px solid #f59e0b",
            color: "#92400e",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Structural warning: {issueCount} issue{issueCount === 1 ? "" : "s"}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))`, gap: 8, marginTop: 12 }}>
        {stages.map((stage, index) => (
          <div
            key={stage.viewElementId}
            className="value-stream-stage"
            style={{
              clipPath: chevronClipPath(12),
              background: stage.structureIssueCount > 0
                ? "linear-gradient(90deg, #ffd9bf 0%, #fdba74 100%)"
                : "linear-gradient(90deg, #fff7d6 0%, #fde68a 100%)",
              border: `1px solid ${stage.structureIssueCount > 0 ? "#f97316" : "#d4b106"}`,
              padding: "12px 24px 12px 18px",
              minHeight: 84,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "#7c5f00", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Stage {index + 1}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#3b2f00", marginTop: 4 }}>
              {stage.element.name}
            </div>
            <div style={{ fontSize: 10, color: "#6a5400", marginTop: 8 }}>
              {stage.element.lifecycleStage} / {stage.element.lifecycleStatus}
            </div>
            {canReorderStages ? (
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {index > 0 ? (
                  <button
                    type="button"
                    title="Move stage left"
                    onClick={() => {
                      void Promise.resolve(
                        data.onMoveStructuredChild?.({
                          childViewElementId: stage.viewElementId,
                          targetOrderIndex: index - 1,
                        }),
                      );
                    }}
                    style={{
                      border: "1px solid #c8b400",
                      background: "#fff8bf",
                      borderRadius: 999,
                      color: "#6a5400",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      cursor: "pointer",
                    }}
                  >
                    Left
                  </button>
                ) : null}
                {index < stages.length - 1 ? (
                  <button
                    type="button"
                    title="Move stage right"
                    onClick={() => {
                      void Promise.resolve(
                        data.onMoveStructuredChild?.({
                          childViewElementId: stage.viewElementId,
                          targetOrderIndex: index + 1,
                        }),
                      );
                    }}
                    style={{
                      border: "1px solid #c8b400",
                      background: "#fff8bf",
                      borderRadius: 999,
                      color: "#6a5400",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      cursor: "pointer",
                    }}
                  >
                    Right
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
