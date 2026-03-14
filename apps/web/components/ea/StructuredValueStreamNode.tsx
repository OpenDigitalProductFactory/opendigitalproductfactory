"use client";

import { useState, type DragEvent } from "react";

import type { SerializedViewElement } from "@/lib/ea-types";

import { buildValueStreamLayout } from "./value-stream-layout";

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

const DRAG_MIME = "application/x-dpf-structured-stage-id";

export function StructuredValueStreamNode({ data, selected = false }: Props) {
  const stages = sortStages(data.childViewElements ?? []);
  const layout = buildValueStreamLayout(stages.map((stage) => stage.element.name));
  const childIssueCount = stages.reduce((sum, stage) => sum + stage.structureIssueCount, 0);
  const issueCount = data.structureIssueCount > 0 ? data.structureIssueCount : childIssueCount;
  const canReorderStages =
    !data.isReadOnly &&
    typeof data.onMoveStructuredChild === "function" &&
    stages.length > 1;
  const [draggedStageId, setDraggedStageId] = useState<string | null>(null);
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);

  function handleDragStart(event: DragEvent<HTMLDivElement>, stageViewElementId: string) {
    if (!canReorderStages) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, stageViewElementId);
    setDraggedStageId(stageViewElementId);
  }

  function handleDragEnd() {
    setDraggedStageId(null);
    setActiveDropIndex(null);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, targetOrderIndex: number) {
    if (!canReorderStages) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setActiveDropIndex(targetOrderIndex);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, targetOrderIndex: number) {
    if (!canReorderStages) return;
    event.preventDefault();
    const childViewElementId =
      event.dataTransfer.getData(DRAG_MIME) || draggedStageId;
    setDraggedStageId(null);
    setActiveDropIndex(null);
    if (!childViewElementId) return;

    await data.onMoveStructuredChild?.({
      childViewElementId,
      targetOrderIndex,
    });
  }

  const bandBorder = issueCount > 0 ? "#f97316" : "#d97706";
  const bandShadow = selected
    ? "0 0 0 3px rgba(245, 158, 11, 0.18)"
    : "0 14px 28px rgba(120, 53, 15, 0.14)";

  return (
    <div
      style={{
        width: layout.bandWidth + 24,
        padding: 12,
      }}
    >
      <div
        data-value-stream-band="true"
        style={{
          clipPath: chevronClipPath(28),
          border: `2px solid ${bandBorder}`,
          background:
            "linear-gradient(135deg, #ffd6a0 0%, #ffbf72 45%, #f7a74d 100%)",
          boxShadow: bandShadow,
          padding: "16px 70px 18px 40px",
          minHeight: 178,
        }}
      >
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
            marginTop: 4,
          }}
        >
          {data.element.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#7c2d12",
            marginTop: 6,
          }}
        >
          {data.element.lifecycleStage} / {data.element.lifecycleStatus}
        </div>

        {issueCount > 0 ? (
          <div
            style={{
              marginTop: 12,
              width: "fit-content",
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(255, 247, 237, 0.86)",
              border: "1px solid #f97316",
              color: "#9a3412",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Structural warning: {issueCount} issue{issueCount === 1 ? "" : "s"}
          </div>
        ) : null}

        <div
          style={{
            marginTop: issueCount > 0 ? 18 : 22,
            display: "flex",
            alignItems: "stretch",
            gap: layout.stageGap,
          }}
        >
          {stages.map((stage, index) => {
            const stageIsActiveDrop = activeDropIndex === index;
            const isDragged = draggedStageId === stage.viewElementId;
            return (
              <div
                key={stage.viewElementId}
                style={{ display: "flex", alignItems: "stretch", gap: layout.stageGap }}
              >
                {canReorderStages ? (
                  <div
                    className="nodrag nopan"
                    data-stage-drop-target={index}
                    onDragOver={(event) => handleDragOver(event, index)}
                    onDrop={(event) => {
                      void handleDrop(event, index);
                    }}
                    onDragEnter={() => setActiveDropIndex(index)}
                    onDragLeave={() => {
                      if (activeDropIndex === index) setActiveDropIndex(null);
                    }}
                    style={{
                      width: 10,
                      alignSelf: "stretch",
                      borderRadius: 999,
                      background: stageIsActiveDrop ? "#c2410c" : "rgba(124, 45, 18, 0.14)",
                      boxShadow: stageIsActiveDrop
                        ? "0 0 0 2px rgba(255, 237, 213, 0.85)"
                        : undefined,
                      transition: "background 0.12s ease, box-shadow 0.12s ease",
                    }}
                  />
                ) : null}

                <div
                  draggable={canReorderStages}
                  className="value-stream-stage nodrag nopan"
                  onDragStart={(event) => handleDragStart(event, stage.viewElementId)}
                  onDragEnd={handleDragEnd}
                  style={{
                    width: layout.stageWidths[index],
                    minHeight: 92,
                    clipPath: chevronClipPath(18),
                    background:
                      stage.structureIssueCount > 0
                        ? "linear-gradient(135deg, #fed7aa 0%, #fb923c 100%)"
                        : "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)",
                    border: `1px solid ${stage.structureIssueCount > 0 ? "#ea580c" : "#c2410c"}`,
                    padding: "14px 28px 14px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    opacity: isDragged ? 0.7 : 1,
                    cursor: canReorderStages ? "grab" : "default",
                    boxShadow: isDragged ? "0 6px 14px rgba(120, 53, 15, 0.22)" : undefined,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#9a3412",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Stage {index + 1}
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
                    {stage.element.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#7c2d12",
                      marginTop: 10,
                    }}
                  >
                    {stage.element.lifecycleStage} / {stage.element.lifecycleStatus}
                  </div>
                </div>
              </div>
            );
          })}

          {canReorderStages ? (
            <div
              className="nodrag nopan"
              data-stage-drop-target={stages.length}
              onDragOver={(event) => handleDragOver(event, stages.length)}
              onDrop={(event) => {
                void handleDrop(event, stages.length);
              }}
              onDragEnter={() => setActiveDropIndex(stages.length)}
              onDragLeave={() => {
                if (activeDropIndex === stages.length) setActiveDropIndex(null);
              }}
              style={{
                width: 10,
                borderRadius: 999,
                background:
                  activeDropIndex === stages.length
                    ? "#c2410c"
                    : "rgba(124, 45, 18, 0.14)",
                boxShadow:
                  activeDropIndex === stages.length
                    ? "0 0 0 2px rgba(255, 237, 213, 0.85)"
                    : undefined,
                transition: "background 0.12s ease, box-shadow 0.12s ease",
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
