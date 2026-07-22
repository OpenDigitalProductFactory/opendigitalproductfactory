"use client";

// One table on the cartesian floor plan (EP-SPATIAL-OPERATIONAL-VIEWS, FLOOR).
// A React Flow custom node whose footprint, shape, and colour come entirely from
// the positioned `FloorPlacement` — live status via the shared `intentStyle`
// tokens, never a local colour map (AGENTS.md §12).

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import { intentStyle } from "@/components/ui/report-kit/statusColors";

import type { FloorPlacement } from "@/lib/storefront/floor-layout";

export type TableFloorNodeData = Pick<
  FloorPlacement,
  "label" | "seats" | "shape" | "w" | "h" | "state" | "stateLabel" | "intent" | "freeInMinutes"
>;

function shapeRadius(shape: FloorPlacement["shape"], w: number, h: number): string {
  if (shape === "round") return "50%";
  if (shape === "bar") return `${Math.min(w, h) / 2}px`; // pill
  if (shape === "booth") return "12px";
  return "8px"; // square
}

function TableFloorNodeImpl({ data }: NodeProps) {
  const d = data as unknown as TableFloorNodeData;
  const style = intentStyle(d.intent);
  const isTurning = d.state === "turning-soon" && d.freeInMinutes != null;

  return (
    <div
      title={`${d.label}${d.seats != null ? ` · ${d.seats} seats` : ""} — ${d.stateLabel}`}
      style={{
        width: d.w,
        height: d.h,
        borderRadius: shapeRadius(d.shape, d.w, d.h),
        border: `2px solid ${style.border}`,
        background: style.softBg,
        color: "var(--dpf-text)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        padding: 4,
        textAlign: "center",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1 }}>{d.label}</span>
      {d.seats != null && (
        <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>{d.seats} seats</span>
      )}
      {isTurning ? (
        <span style={{ fontSize: 9, fontWeight: 600, color: style.fg }}>{d.freeInMinutes}m</span>
      ) : (
        <span style={{ fontSize: 9, color: style.fg }}>{d.stateLabel}</span>
      )}
    </div>
  );
}

export const TableFloorNode = memo(TableFloorNodeImpl);
